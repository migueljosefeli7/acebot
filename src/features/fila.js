const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const money = require('../lib/money');
const wallet = require('../lib/wallet');
const banners = require('../lib/banners');
const emo = require('../lib/emojis');

const GELO = { INFINITO: 'Gelo Infinito', NORMAL: 'Gelo Normal' };

const MODALIDADES = [
  '1x1 Mobile', '2x2 Mobile', '3x3 Mobile', '4x4 Mobile',
  '2x2 Misto', '3x3 Misto', '4x4 Misto',
  '1x1 Emulador', '2x2 Emulador', '3x3 Emulador', '4x4 Emulador',
  '1x1 Tático', '2x2 Tático', '3x3 Tático', '4x4 Tático',
];

const getQueue = (id) => db.prepare('SELECT * FROM queues WHERE id = ?').get(id);
const entradas = (queueId) =>
  db.prepare('SELECT * FROM queue_entries WHERE queue_id = ? ORDER BY joined_at ASC').all(queueId);

/* -------------------------------------------------------------- MODO/GELO */

/** "Misto" (1 emu + resto mobile por time) não usa gelo — usa quantidade de EMU no time. */
const ehMisto = (modalidade) => /misto/i.test(modalidade || '');

/** Tamanho do time a partir do "3x3 Misto" -> 3. Nunca existe 1x1 Misto (precisa de pelo menos 1 emu + 1 mobile). */
const tamanhoTime = (modalidade) => {
  const m = /^(\d)x\d/i.exec(String(modalidade || ''));
  return m ? Number(m[1]) : 1;
};

/**
 * Opções de entrada na fila dessa modalidade — cada uma vira um botão e só
 * empareia com quem escolheu o MESMO valor (mesma regra pro gelo e pro EMU).
 *  - Mobile/Emulador/Tático: Gelo Normal ou Gelo Infinito (fixo).
 *  - Misto: quantidade de EMU no time, de 1 até (tamanho do time - 1).
 */
function opcoesModo(modalidade) {
  if (ehMisto(modalidade)) {
    const qtd = Math.max(1, tamanhoTime(modalidade) - 1);
    return Array.from({ length: qtd }, (_, i) => {
      const n = i + 1;
      return { valor: `EMU${n}`, label: `${n} Emu`, emoji: emo.emulador };
    });
  }
  return [
    { valor: 'INFINITO', label: 'Gelo Infinito', emoji: emo.infinito },
    { valor: 'NORMAL', label: 'Gelo Normal', emoji: emo.gelo },
  ];
}

/** Rótulo pra exibir um valor de gelo/EMU já salvo (ticket, log, painel de streamer). */
function rotuloModo(gelo) {
  if (gelo === 'INFINITO') return 'Gelo Infinito';
  if (gelo === 'NORMAL') return 'Gelo Normal';
  const m = /^EMU(\d+)$/.exec(gelo || '');
  if (m) return `${m[1]} Emu`;
  return gelo || '—';
}

/* ------------------------------------------------------------------ PAINEL */

/** Uma linha por opção que tem gente — "emoji Rótulo | @a, @b". Opção vazia nem aparece. */
function linhasJogadores(q) {
  const lista = entradas(q.id);

  const linhas = opcoesModo(q.modalidade)
    .map(({ valor, label, emoji }) => {
      const gente = lista.filter((e) => e.gelo === valor);
      return gente.length ? `${emoji} ${label} | ${gente.map((e) => `<@${e.user_id}>`).join(', ')}` : null;
    })
    .filter(Boolean);

  return linhas.length ? linhas.join('\n') : '_ninguém na fila_';
}

function painel(q, { bannerUrl = null } = {}) {
  const banner = bannerUrl || q.banner;
  const campoModo = `${emo.partida} Modo de Jogo\n**${q.modalidade}**`;
  const campoValor = `${emo.cifrao} Valor Partida\n**${money.fmt(q.valor)}**`;
  const opcoes = opcoesModo(q.modalidade);

  return ui.bloco(cfg.COR.primaria,
    // Modo + valor juntos na mesma secao, ao lado da mesma thumbnail — sem vao entre os dois.
    banner ? ui.comThumb([campoModo, campoValor], banner) : [ui.txt(campoModo), ui.txt(campoValor)],
    ui.divisor(),
    ui.txt(`${emo.duas} Jogadores na fila\n${linhasJogadores(q)}`),
    ui.divisor(),
    ui.linhaBotoes(
      ...opcoes.map(({ valor, label, emoji }) => ui.botao(`queue:join:${q.id}:${valor}`, label, { emoji })),
      ui.botao(`queue:leave:${q.id}`, 'Sair', { estilo: ui.ESTILO.Danger, emoji: emo.sair }),
    ),
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

/* ------------------------------------------------------------- GERENCIAR */

const listarTodas = (guildId) => db.prepare('SELECT * FROM queues WHERE guild_id = ? ORDER BY id').all(guildId);

async function republicarUma(client, q) {
  const ch = await client.channels.fetch(q.channel_id);
  await publicarPainel(ch, q);
  return ch;
}

/** Republica o painel de toda fila ATIVA do servidor de uma vez (usado sem passar ID). */
async function republicarTodas(client, guildId) {
  const ativas = db.prepare('SELECT * FROM queues WHERE guild_id = ? AND ativo = 1').all(guildId);
  let ok = 0;
  const falhas = [];
  for (const q of ativas) {
    try {
      await republicarUma(client, q);
      ok++;
    } catch (e) {
      falhas.push({ id: q.id, motivo: e.message });
      console.error(`[fila] falha ao republicar #${q.id}:`, e.message);
    }
  }
  return { total: ativas.length, ok, falhas };
}

/** Desativa (soft): devolve saldo travado, some com o painel, mas mantém o registro no banco. */
async function desativar(client, q) {
  const devolvidos = entradas(q.id);
  for (const e of devolvidos) {
    try { wallet.unlock(e.user_id, q.valor); } catch { /* trava ja resolvida */ }
  }
  db.prepare('DELETE FROM queue_entries WHERE queue_id = ?').run(q.id);
  db.prepare('UPDATE queues SET ativo = 0 WHERE id = ?').run(q.id);

  try {
    const ch = await client.channels.fetch(q.channel_id);
    const msg = await ch.messages.fetch(q.message_id);
    await msg.delete();
  } catch { /* mensagem ja apagada */ }

  return devolvidos;
}

/** Apaga PRA SEMPRE: some do banco de verdade (nao so ativo=0) — irreversivel. */
async function apagarPermanente(client, q) {
  const devolvidos = await desativar(client, q);
  db.prepare('DELETE FROM queues WHERE id = ?').run(q.id);
  return devolvidos;
}

module.exports = {
  GELO, MODALIDADES, getQueue, entradas, listarTodas,
  ehMisto, tamanhoTime, opcoesModo, rotuloModo,
  linhasJogadores, painel, arteLocal, mensagemPainel, atualizarPainel, publicarPainel,
  republicarUma, republicarTodas, desativar, apagarPermanente,
  entrarNaFila, sairDaFila,
};
