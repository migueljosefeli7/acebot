const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const money = require('../lib/money');
const wallet = require('../lib/wallet');
const banners = require('../lib/banners');

const GELO = { INFINITO: 'Gelo Infinito', NORMAL: 'Gelo Normal' };

const MODALIDADES = [
  '1x1 Mobile', '2x2 Mobile', '3x3 Mobile', '4x4 Mobile',
  '1x1 Misto', '2x2 Misto', '3x3 Misto', '4x4 Misto',
  '1x1 Emulador', '2x2 Emulador', '3x3 Emulador', '4x4 Emulador',
  '1x1 Tático', '2x2 Tático', '3x3 Tático', '4x4 Tático',
];

const getQueue = (id) => db.prepare('SELECT * FROM queues WHERE id = ?').get(id);
const entradas = (queueId) =>
  db.prepare('SELECT * FROM queue_entries WHERE queue_id = ? ORDER BY joined_at ASC').all(queueId);

/* ------------------------------------------------------------------ PAINEL */

function dadosDaFila(q) {
  const lista = entradas(q.id);
  const porGelo = (g) => lista.filter((e) => e.gelo === g);

  const jogadores = (g) => porGelo(g)
    .map((e) => `└ <@${e.user_id}>${e.pago ? '' : ' · 💳 paga no ticket'}`)
    .join('\n') || '_ninguém na fila_';

  const linha = (g, emoji) => {
    const gente = porGelo(g);
    return gente.length
      ? `${emoji} **${GELO[g]}** · ${gente.length} na fila\n` +
        gente.map((e) => `└ <@${e.user_id}>${e.pago ? '' : ' · 💳 paga no ticket'}`).join('\n')
      : `${emoji} **${GELO[g]}** · _ninguém na fila_`;
  };

  return {
    total: lista.length,
    totalInfinito: porGelo('INFINITO').length,
    totalNormal: porGelo('NORMAL').length,
    jogadoresInfinito: jogadores('INFINITO'),
    jogadoresNormal: jogadores('NORMAL'),
    infinito: linha('INFINITO', '<:infinito:1542027016768069702>'),
    normal: linha('NORMAL', '<:glo:1542027218341994618>'),
  };
}

function painel(q, { bannerUrl = null } = {}) {
  const dados = dadosDaFila(q);
  const banner = bannerUrl || q.banner;
  const cabecalho = [`## ${q.modalidade}`,
    `-# Fila #${q.id} · a partida fecha com 1 jogador de cada lado no mesmo modo`];
  const premio = q.valor * 2 - cfg.taxaPartida;

  return ui.bloco(cfg.COR.primaria,
    // Banner pequeno no canto (thumbnail), nao mais a imagem larga.
    banner ? ui.comThumb(cabecalho, banner) : [ui.titulo(q.modalidade), ui.nota(cabecalho[1].replace(/^-#\s*/, ''))],
    ui.divisor(),
    // Campo com rotulo em cima e valor em negrito embaixo — limpo, sem misturar tamanho de titulo.
    ui.txt(`<:cifrao:1542021614600978452> Valor Partida\n**${money.fmt(q.valor)}**`),
    ui.txt(`<:cifrao:1542021614600978452> Prêmio ao vencedor\n**${money.fmt(premio)}**`),
    ui.divisor(),
    ui.txt(`<:duas:1542028376452370482> Jogadores na fila\n${dados.infinito}\n\n${dados.normal}`),
    ui.divisor(),
    ui.linhaBotoes(
      ui.botao(`queue:join:${q.id}:INFINITO`, 'Gelo Infinito', { emoji: '<:infinito:1542027016768069702>' }),
      ui.botao(`queue:join:${q.id}:NORMAL`, 'Gelo Normal', { emoji: '<:glo:1542027218341994618>' }),
      ui.botao(`queue:leave:${q.id}`, 'Sair', { estilo: ui.ESTILO.Danger }),
    ),
    ui.nota('Com saldo, o valor é reservado ao entrar. Sem saldo, você paga essa partida no ticket.'),
  );
}

/** Usa a arte local da modalidade quando a fila não possui um banner personalizado. */
function arteLocal(q) {
  return q.banner ? null : banners.obter(q.modalidade);
}

function mensagemPainel(q, { anexarBanner = false } = {}) {
  const banner = arteLocal(q);
  return ui.msg(
    painel(q, { bannerUrl: q.banner || banner?.url }),
    banner && anexarBanner
      ? { files: [{ attachment: banner.caminho, name: banner.nome }] }
      : {},
  );
}

/** Reescreve a mensagem do painel da fila. Silencioso se a mensagem sumiu. */
async function atualizarPainel(client, queueId) {
  const q = getQueue(queueId);
  if (!q || !q.message_id) return;
  try {
    const ch = await client.channels.fetch(q.channel_id);
    const msg = await ch.messages.fetch(q.message_id);
    const banner = arteLocal(q);
    const jaTemBanner = banner && msg.attachments.some((a) => a.name === banner.nome);
    await msg.edit(mensagemPainel(q, { anexarBanner: !!banner && !jaTemBanner }));
  } catch (e) {
    console.warn(`[fila #${queueId}] nao consegui atualizar o painel:`, e.message);
  }
}

async function publicarPainel(channel, q) {
  const msg = await channel.send(mensagemPainel(q, { anexarBanner: true }));
  db.prepare('UPDATE queues SET message_id = ? WHERE id = ?').run(msg.id, q.id);
  return msg;
}

/* -------------------------------------------------------------- ENTRAR/SAIR */

/**
 * Aviso para quem entrou na fila sem saldo. Não bloqueia: explica que o
 * pagamento daquela partida acontece dentro do ticket.
 */
const semSaldoResposta = (falta, saldo, valor) => ui.msg(ui.bloco(cfg.COR.aviso,
  ui.titulo('⚠️ VOCÊ ENTROU SEM SALDO'),
  ui.txt('Tudo certo — quando a partida fechar, **você paga essa partida direto no ticket** por PIX.'),
  ui.divisor(),
  ui.tabela([
    ['Custo da partida', money.fmt(valor)],
    ['Seu saldo', money.fmt(saldo)],
    ['Falta pagar', money.fmt(falta)],
  ]),
  ui.divisor(),
  ui.txt(
    'Se preferir, deposite agora e o valor já fica reservado ao entrar na fila.\n' +
    '⏱️ Se você não pagar no prazo, a partida é cancelada e o adversário recebe o dinheiro de volta.'
  ),
  ui.linhaBotoes(
    ui.botao('wallet:deposit', 'DEPOSITAR AGORA', { estilo: ui.ESTILO.Success, emoji: '📥' }),
    ui.botao('wallet:profile', 'MEU PERFIL', { emoji: '👤' }),
  ),
), { efemero: true });

/**
 * Entra na fila. Retorna { erro } ou { ok: true, matchId? }.
 *
 * O emparelhamento e feito dentro da mesma transacao da insercao para nao
 * existir janela onde 3 jogadores fecham 2 partidas com o mesmo oponente.
 */
const entrarNaFila = db.transaction((queueId, userId, gelo) => {
  const q = getQueue(queueId);
  if (!q || !q.ativo) return { erro: 'FILA_INATIVA' };

  const u = wallet.ensureUser(userId);
  if (u.banned) return { erro: 'BANIDO' };

  // Fila exclusiva de streamer: só empareia com ELE, nunca entre dois desafiantes
  // aleatorios, e só aceita gente enquanto ele estiver de fato sentado nela.
  if (q.streamer_id && userId !== q.streamer_id) {
    const streamerSentado = db.prepare('SELECT 1 FROM queue_entries WHERE queue_id = ? AND user_id = ?')
      .get(queueId, q.streamer_id);
    if (!streamerSentado) return { erro: 'STREAMER_OFFLINE' };
  }

  const emPartida = db.prepare(
    `SELECT id FROM matches WHERE (p1 = ? OR p2 = ?)
     AND status NOT IN ('FINALIZADA', 'CANCELADA') LIMIT 1`
  ).get(userId, userId);
  if (emPartida) return { erro: 'EM_PARTIDA', matchId: emPartida.id };

  let filaAnterior = null;
  const jaNaFila = db.prepare('SELECT * FROM queue_entries WHERE user_id = ?').get(userId);
  if (jaNaFila) {
    if (jaNaFila.queue_id === queueId && jaNaFila.gelo === gelo) return { erro: 'JA_NA_FILA' };
    // Trocou de fila ou de modo de gelo: devolve o valor travado da fila antiga.
    const antiga = getQueue(jaNaFila.queue_id);
    db.prepare('DELETE FROM queue_entries WHERE queue_id = ? AND user_id = ?').run(jaNaFila.queue_id, userId);
    if (antiga) {
      wallet.unlock(userId, antiga.valor);
      if (antiga.id !== queueId) filaAnterior = antiga.id;
    }
  }

  // Quem tem saldo trava na hora. Quem nao tem entra assim mesmo e paga
  // aquela partida direto no ticket, sem passar pelo saldo da conta.
  const saldo = wallet.getJogavel(userId);
  const pago = saldo >= q.valor ? 1 : 0;
  if (pago) wallet.lock(userId, q.valor);

  db.prepare('INSERT INTO queue_entries (queue_id, user_id, gelo, pago, joined_at) VALUES (?, ?, ?, ?, ?)')
    .run(queueId, userId, gelo, pago, Date.now());

  // Procura adversario: mesma fila, mesmo modo de gelo, jogador diferente, o mais antigo.
  // Numa fila exclusiva de streamer, o unico adversario valido e o proprio streamer.
  const par = q.streamer_id
    ? db.prepare(
        `SELECT * FROM queue_entries WHERE queue_id = ? AND gelo = ? AND user_id != ? AND user_id = ?
         ORDER BY joined_at ASC LIMIT 1`
      ).get(queueId, gelo, userId, q.streamer_id)
    : db.prepare(
        `SELECT * FROM queue_entries WHERE queue_id = ? AND gelo = ? AND user_id != ?
         ORDER BY joined_at ASC LIMIT 1`
      ).get(queueId, gelo, userId);

  if (!par) return { ok: true, queue: q, filaAnterior, pago, saldo, falta: pago ? 0 : q.valor - saldo };

  db.prepare('DELETE FROM queue_entries WHERE queue_id = ? AND user_id IN (?, ?)').run(queueId, userId, par.user_id);

  // p1 = quem estava esperando, p2 = quem acabou de entrar.
  const tudoPago = par.pago && pago;
  const info = db.prepare(
    `INSERT INTO matches (guild_id, queue_id, modalidade, gelo, valor, taxa, p1, p2,
                          pago_p1, pago_p2, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(q.guild_id, q.id, q.modalidade, gelo, q.valor, cfg.taxaPartida, par.user_id, userId,
    par.pago, pago, tudoPago ? 'AGUARDANDO_REGRAS' : 'AGUARDANDO_PAGAMENTO', Date.now());

  return {
    ok: true, queue: q, filaAnterior, pago, saldo,
    falta: pago ? 0 : q.valor - saldo,
    matchId: info.lastInsertRowid,
  };
});

const sairDaFila = db.transaction((queueId, userId) => {
  const e = db.prepare('SELECT * FROM queue_entries WHERE queue_id = ? AND user_id = ?').get(queueId, userId);
  if (!e) return { erro: 'NAO_ESTA_NA_FILA' };
  const q = getQueue(queueId);
  db.prepare('DELETE FROM queue_entries WHERE queue_id = ? AND user_id = ?').run(queueId, userId);
  // Só devolve quem chegou a travar valor; quem entrou sem saldo não travou nada.
  if (q && e.pago) wallet.unlock(userId, q.valor);
  return { ok: true, valor: q && e.pago ? q.valor : 0 };
});

module.exports = {
  GELO, MODALIDADES, getQueue, entradas,
  dadosDaFila, painel, arteLocal, mensagemPainel, atualizarPainel, publicarPainel,
  entrarNaFila, sairDaFila, semSaldoResposta,
};
