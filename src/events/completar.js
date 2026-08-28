const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const money = require('../lib/money');
const gc = require('../lib/guildconfig');
const completar = require('../features/completar');
const carteira = require('../features/carteira');

const PREFIXO_COMPLETA = /^\+(?:co|com|completa)\b/i;
const PREFIXO_PERFIL = /^\+perfil\b/i;
const MENCAO = /<@!?(\d+)>/;

const erro = (message, titulo, texto) => message.reply(ui.msg(
  ui.bloco(cfg.COR.erro, ui.titulo(`❌ ${titulo}`), ui.txt(texto)),
)).catch(() => {});

/** A partida "com a fila já puxada" de um jogador: existe um match dele que ainda não acabou. */
const partidaAtivaDoLider = (guildId, liderId) => db.prepare(
  `SELECT * FROM matches WHERE guild_id = ? AND (p1 = ? OR p2 = ?)
     AND status NOT IN ('FINALIZADA', 'CANCELADA') ORDER BY created_at DESC LIMIT 1`
).get(guildId, liderId, liderId);

const estaAguardandoFila = (userId) => !!db.prepare('SELECT 1 FROM queue_entries WHERE user_id = ?').get(userId);

/** O alvo vem de uma menção (em qualquer posição do texto) ou, na falta dela, de quem escreveu a mensagem respondida. */
async function resolverAlvo(message, resto) {
  const mencao = resto.match(MENCAO);
  if (mencao) return { alvoId: mencao[1], restoSemMencao: resto.replace(mencao[0], '').trim() };

  if (message.reference) {
    const original = await message.fetchReference().catch(() => null);
    if (original && !original.author.bot) return { alvoId: original.author.id, restoSemMencao: resto.trim() };
  }
  return null;
}

/**
 * Roda em qualquer canal, mas só faz algo dentro do canal configurado em
 * `canal_completar` — diferente do modelo antigo (preso à thread da partida),
 * porque agora o pedido de completa é feito num mural público, ANTES de o
 * completador necessariamente estar no ticket.
 */
module.exports = async function onCompletar(message) {
  try {
    if (message.author.bot || !message.guildId) return;

    const canalId = gc.get(message.guildId, 'canal_completar');
    if (!canalId || message.channel.id !== canalId) return;

    const texto = message.content.trim();

    /* --------------------------------------------------------------- +perfil */
    if (PREFIXO_PERFIL.test(texto)) {
      const resto = texto.replace(PREFIXO_PERFIL, '').trim();
      const alvo = await resolverAlvo(message, resto);
      const alvoId = alvo?.alvoId || message.author.id;

      const membro = await message.guild.members.fetch(alvoId).catch(() => null);
      if (!membro) return erro(message, 'Não encontrei esse jogador', 'Marque alguém ou responda a mensagem da pessoa.');

      return message.reply(ui.msg(carteira.perfilPublico(membro.user))).catch(() => {});
    }

    if (!PREFIXO_COMPLETA.test(texto)) return;
    const resto = texto.replace(PREFIXO_COMPLETA, '').trim();

    /* --------------------------------------------------------- +completa cancelar */
    if (/^cancelar\b/i.test(resto)) {
      const m = partidaAtivaDoLider(message.guildId, message.author.id);
      if (!m) return erro(message, 'Você não está em partida', 'Só o dono da partida (fila já puxada) pode cancelar um completa.');

      const r = completar.cancelarPeloLider(m, message.author.id);
      if (r.erro === 'SEM_COMPLETA') return erro(message, 'Nada pra cancelar', 'Não existe completa pendente ou aceito nessa sua partida.');

      return message.reply(ui.msg(ui.bloco(cfg.COR.neutro,
        ui.titulo('🚫 COMPLETA CANCELADO'),
        ui.txt(r.tinhaDinheiroMovido
          ? `O valor de <@${r.completa.completador}> foi devolvido.`
          : 'O convite pendente foi recusado.'),
      ))).catch(() => {});
    }

    /* ------------------------------------------- +completa/+com/+co [@alvo] valor */
    const alvo = await resolverAlvo(message, resto);
    if (!alvo) {
      return erro(message, 'Uso incorreto',
        'Marque quem tem a partida (`+completa @jogador 20`) ou responda a mensagem da pessoa (`+completa 20`).');
    }
    if (alvo.alvoId === message.author.id) {
      return erro(message, 'Alvo inválido', 'Você não pode completar com você mesmo.');
    }

    const valorTexto = alvo.restoSemMencao.match(/[\d.,]+/);
    if (!valorTexto) return erro(message, 'Valor não encontrado', 'Informe um valor. Ex: `+com @jogador 20` ou `+com 20 @jogador`.');
    const valor = money.parse(valorTexto[0]);
    if (valor === null || valor <= 0) return erro(message, 'Valor inválido', 'Use um valor tipo `20` ou `20,00`.');

    const m = partidaAtivaDoLider(message.guildId, alvo.alvoId);
    if (!m) {
      if (estaAguardandoFila(alvo.alvoId)) {
        return erro(message, 'Ele está aguardando em fila', 'A partida ainda não foi puxada — espere formar antes de completar.');
      }
      return erro(message, 'Sem partida ativa', 'Esse jogador não está em nenhuma partida agora.');
    }

    // liderId = quem foi marcado/respondido (dono da partida) · alvoId = quem escreveu (paga o completa).
    const r = completar.solicitar(m, alvo.alvoId, message.author.id, valor);

    if (r.erro === 'LIDER_INVALIDO') return erro(message, 'Alvo inválido', 'A pessoa marcada precisa ser o dono da partida.');
    if (r.erro === 'ALVO_PROPRIO') return erro(message, 'Alvo inválido', 'Você não pode completar com você mesmo.');
    if (r.erro === 'ALVO_E_ADVERSARIO') return erro(message, 'Alvo inválido', 'Você é o adversário dessa partida — não dá pra completar contra ela.');
    if (r.erro === 'VALOR_INVALIDO') return erro(message, 'Valor inválido', 'Informe um valor maior que zero.');
    if (r.erro === 'VALOR_MAIOR_QUE_STAKE') return erro(message, 'Valor alto demais', `O completa precisa ser menor que a stake (${money.fmt(m.valor)}).`);
    if (r.erro === 'PARTIDA_ENCERRADA') return erro(message, 'Partida encerrada', 'Essa partida já foi finalizada ou cancelada.');
    if (r.erro === 'JA_TEM_COMPLETA') return erro(message, 'Já tem um completa', 'Esse lado já tem um completa pendente ou aceito nesta partida.');

    const c = completar.getPorId(r.id);
    await message.reply(ui.msg(completar.painelConvite(m, c))).catch(() => {});
  } catch (e) {
    console.error('[completar]', e.message);
  }
};
