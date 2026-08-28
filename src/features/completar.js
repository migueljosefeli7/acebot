const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const money = require('../lib/money');
const wallet = require('../lib/wallet');

/**
 * Completar aposta: um jogador (lider) divide a propria stake com outro
 * (completador), que entra com uma fatia do valor. Vitoria e derrota sao
 * divididas na mesma proporcao.
 *
 * Mecanica de dinheiro (fecha o caixa em todos os casos, testado):
 *  1. Ao ACEITAR: completador -> lider, no valor da fatia (reembolso de
 *     entrada). So mexe em saldo REAL, nao usa bonus.
 *  2. Se o lado do lider VENCE: lider -> completador, na MESMA proporcao
 *     sobre o premio inteiro. Resultado liquido: os dois lucram/perdem
 *     exatamente na fatia que cada um colocou.
 *  3. Se o lado do lider PERDE: nada se move — o completador ja tinha
 *     perdido a fatia dele no passo 1, o lider ja perde a apostas dele como
 *     sempre (fluxo existente, sem mudanca).
 *  4. Se a partida e ANULADA/CANCELADA antes do resultado: desfaz o passo 1.
 */

const getPorId = (id) => db.prepare('SELECT * FROM completas WHERE id = ?').get(id);
const getAceita = (matchId, lado) => db.prepare(
  "SELECT * FROM completas WHERE match_id = ? AND lado = ? AND status = 'ACEITO'"
).get(matchId, lado);
const getPendente = (matchId, lado) => db.prepare(
  "SELECT * FROM completas WHERE match_id = ? AND lado = ? AND status = 'PENDENTE'"
).get(matchId, lado);

/**
 * Valida e cria o pedido. Nao mexe em dinheiro ainda — so mexe quando o
 * completador aceitar.
 */
function solicitar(m, liderId, alvoId, valor) {
  if (![m.p1, m.p2].includes(liderId)) return { erro: 'LIDER_INVALIDO' };
  if (alvoId === liderId) return { erro: 'ALVO_PROPRIO' };
  if ([m.p1, m.p2].includes(alvoId)) return { erro: 'ALVO_E_ADVERSARIO' };
  if (!Number.isInteger(valor) || valor <= 0) return { erro: 'VALOR_INVALIDO' };
  if (valor >= m.valor) return { erro: 'VALOR_MAIOR_QUE_STAKE' };
  if (['FINALIZADA', 'CANCELADA'].includes(m.status)) return { erro: 'PARTIDA_ENCERRADA' };

  const lado = liderId === m.p1 ? 'p1' : 'p2';
  if (getAceita(m.id, lado) || getPendente(m.id, lado)) return { erro: 'JA_TEM_COMPLETA' };

  const info = db.prepare(
    `INSERT INTO completas (match_id, lado, lider, completador, valor_lider, valor_completador, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(m.id, lado, liderId, alvoId, m.valor - valor, valor, Date.now());

  return { ok: true, id: info.lastInsertRowid, lado, valorLider: m.valor - valor, valorCompletador: valor };
}

/**
 * Quem ACEITA é sempre o líder (o dono da partida/stake, quem já tem a fila
 * puxada) — é a stake dele que vai ser dividida. O completador só entrou com
 * o pedido; o dinheiro dele (debito abaixo) só se move se o líder topar.
 */
const aceitar = db.transaction((completaId, quemClicou) => {
  const c = getPorId(completaId);
  if (!c) return { erro: 'NAO_EXISTE' };
  if (c.status !== 'PENDENTE') return { erro: 'JA_RESOLVIDO' };
  if (c.lider !== quemClicou) return { erro: 'NAO_E_O_ALVO' };

  try {
    wallet.debit(c.completador, c.valor_completador, 'COMPLETA',
      `Completou aposta da partida #${c.match_id}`, `completa:${c.id}`);
  } catch {
    return { erro: 'SEM_SALDO' };
  }
  wallet.credit(c.lider, c.valor_completador, 'COMPLETA',
    `Recebeu completa da partida #${c.match_id}`, `completa:${c.id}`);

  db.prepare("UPDATE completas SET status = 'ACEITO', resolved_at = ? WHERE id = ?").run(Date.now(), completaId);
  return { ok: true, completa: getPorId(completaId) };
});

function recusar(completaId, quemClicou) {
  const c = getPorId(completaId);
  if (!c) return { erro: 'NAO_EXISTE' };
  if (c.status !== 'PENDENTE') return { erro: 'JA_RESOLVIDO' };
  if (c.lider !== quemClicou) return { erro: 'NAO_E_O_ALVO' };

  db.prepare("UPDATE completas SET status = 'RECUSADO', resolved_at = ? WHERE id = ?").run(Date.now(), completaId);
  return { ok: true };
}

/**
 * Chamado na hora do payout (dentro de finalizarPartida), so quando o LADO
 * completado venceu. Transfere a fatia proporcional do premio para o
 * completador. Retorna null se nao havia completa aceito nesse lado.
 */
const liquidarNaVitoria = db.transaction((m, vencedorId) => {
  const lado = vencedorId === m.p1 ? 'p1' : 'p2';
  const c = getAceita(m.id, lado);
  if (!c) return null;

  const premioTotal = m.valor * 2 - m.taxa;
  const fatia = Math.round((premioTotal * c.valor_completador) / m.valor);
  if (fatia <= 0) return null;

  wallet.debit(vencedorId, fatia, 'COMPLETA',
    `Repasse de completa (partida #${m.id})`, `completa:${c.id}`);
  wallet.credit(c.completador, fatia, 'COMPLETA',
    `Recebeu fatia do premio (partida #${m.id})`, `completa:${c.id}`);

  db.prepare("UPDATE completas SET status = 'CANCELADO', resolved_at = ? WHERE id = ? AND status = 'ACEITO'")
    .run(Date.now(), c.id); // liquidado: nao ha mais nada pendente nesse completa
  return { completadorId: c.completador, fatia };
});

/**
 * "+completa cancelar": só quem TEM a partida (o líder, dono da stake) pode
 * desfazer. Cobre os dois estados possíveis:
 *  - PENDENTE: vira RECUSADO, ninguem pagou nada ainda.
 *  - ACEITO: desfaz a transferencia do aceite (mesma logica do estorno por
 *    cancelamento de partida), so que sem cancelar a partida em si.
 */
const cancelarPeloLider = db.transaction((m, quemPediu) => {
  if (![m.p1, m.p2].includes(quemPediu)) return { erro: 'NAO_E_JOGADOR' };
  const lado = quemPediu === m.p1 ? 'p1' : 'p2';

  const aceito = getAceita(m.id, lado);
  if (aceito) {
    wallet.debit(aceito.lider, aceito.valor_completador, 'COMPLETA_ESTORNO',
      `Completa cancelado manualmente (partida #${m.id})`, `completa:${aceito.id}`);
    wallet.credit(aceito.completador, aceito.valor_completador, 'COMPLETA_ESTORNO',
      `Completa cancelado manualmente (partida #${m.id})`, `completa:${aceito.id}`);
    db.prepare("UPDATE completas SET status = 'CANCELADO', resolved_at = ? WHERE id = ?").run(Date.now(), aceito.id);
    return { ok: true, completa: aceito, tinhaDinheiroMovido: true };
  }

  const pendente = getPendente(m.id, lado);
  if (pendente) {
    db.prepare("UPDATE completas SET status = 'RECUSADO', resolved_at = ? WHERE id = ?").run(Date.now(), pendente.id);
    return { ok: true, completa: pendente, tinhaDinheiroMovido: false };
  }

  return { erro: 'SEM_COMPLETA' };
});

/** Desfaz o reembolso de entrada se a partida for cancelada/anulada antes do resultado. */
const estornarCompletas = db.transaction((m) => {
  const desfeitos = [];
  for (const lado of ['p1', 'p2']) {
    const c = getAceita(m.id, lado);
    if (!c) continue;
    wallet.debit(c.lider, c.valor_completador, 'COMPLETA_ESTORNO',
      `Partida #${m.id} cancelada — devolve completa`, `completa:${c.id}`);
    wallet.credit(c.completador, c.valor_completador, 'COMPLETA_ESTORNO',
      `Partida #${m.id} cancelada — devolve completa`, `completa:${c.id}`);
    db.prepare("UPDATE completas SET status = 'CANCELADO', resolved_at = ? WHERE id = ?").run(Date.now(), c.id);
    desfeitos.push(c);
  }
  return desfeitos;
});

/* --------------------------------------------------------------- PAINEIS */

function painelConvite(m, c) {
  const pctCompletador = Math.round((c.valor_completador / m.valor) * 100);
  const pctLider = 100 - pctCompletador;
  const statusTxt = c.status === 'ACEITO' ? '🟢 Confirmado'
    : c.status === 'RECUSADO' ? '🔴 Recusado'
    : c.status === 'CANCELADO' ? '⚪ Cancelado'
    : `⏳ Aguardando resposta de <@${c.lider}>`;

  return ui.bloco(c.status === 'ACEITO' ? cfg.COR.sucesso : cfg.COR.aviso,
    ui.titulo('🤝 CONVITE PARA COMPLETAR'),
    ui.nota(`Partida #${m.id} · ${m.modalidade}`),
    ui.divisor(),
    ui.txt(`<@${c.completador}> quer **completar** usando ${money.fmt(c.valor_completador)} de saldo com <@${c.lider}>.`),
    ui.tabela([
      ['Solicitante (quem paga)', `<@${c.completador}>`],
      ['Alvo (dono da aposta)', `<@${c.lider}>`],
      ['Valor do completa', money.fmt(c.valor_completador)],
      ['Status', statusTxt],
    ]),
    c.status === 'PENDENTE' ? ui.linhaBotoes(
      ui.botao(`completa:sim:${c.id}`, 'Aceitar', { estilo: ui.ESTILO.Success, emoji: '✅' }),
      ui.botao(`completa:nao:${c.id}`, 'Recusar', { estilo: ui.ESTILO.Danger, emoji: '❌' }),
      ui.botao(`completa:como:${c.id}`, 'Como funciona?', { estilo: ui.ESTILO.Secondary, emoji: 'ℹ️' }),
    ) : ui.nota(`<@${c.lider}> pode digitar \`+completa cancelar\` no ticket pra desfazer isso.`),
  );
}

/** Explicação da mecânica, mostrada quando alguém clica "Como funciona?". */
function textoComoFunciona(c) {
  const pctCompletador = Math.round((c.valor_completador / (c.valor_lider + c.valor_completador)) * 100);
  const pctLider = 100 - pctCompletador;
  return ui.bloco(cfg.COR.neutro,
    ui.titulo('ℹ️ COMO FUNCIONA O COMPLETA'),
    ui.divisor(),
    ui.txt(
      `<@${c.completador}> entra com ${money.fmt(c.valor_completador)} (**${pctCompletador}%** da stake) e ` +
      `<@${c.lider}> segue dono do restante (**${pctLider}%**).\n\n` +
      '• Se aceitar: o valor sai do saldo de quem completou e vai pro dono da aposta agora (reembolso de entrada).\n' +
      '• Se o lado vencer: o dono repassa a mesma proporção do prêmio pra quem completou.\n' +
      '• Se o lado perder: ninguém recebe nada extra — cada um já perdeu a fatia que colocou.\n' +
      '• O dono da aposta pode desfazer a qualquer momento (antes do resultado) com `+completa cancelar`.'
    ),
  );
}

module.exports = {
  solicitar, aceitar, recusar, cancelarPeloLider, liquidarNaVitoria, estornarCompletas,
  getPorId, getAceita, getPendente, painelConvite, textoComoFunciona,
};
