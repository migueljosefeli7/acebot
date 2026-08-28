const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const money = require('../lib/money');
const gc = require('../lib/guildconfig');
const fila = require('./fila');
const streamers = require('./streamers');

const getFilaAtiva = (guildId, streamerId) =>
  db.prepare('SELECT * FROM queues WHERE guild_id = ? AND streamer_id = ? AND ativo = 1').get(guildId, streamerId);

function painel(q, streamer) {
  const restantes = q.limite_partidas ? Math.max(0, q.limite_partidas - (q.partidas_jogadas || 0)) : null;

  return ui.bloco(cfg.COR.erro,
    ui.titulo(`🎥 DESAFIE <@${q.streamer_id}> AO VIVO`),
    streamer?.titulo ? ui.nota(streamer.titulo) : null,
    streamer?.link ? ui.comBotao('Assista a live:', ui.botaoLink(streamer.link, 'ASSISTIR', '📺')) : null,
    ui.divisor(),
    q.regras ? ui.secao('📋 Regras') : null,
    q.regras ? ui.txt(q.regras) : null,
    q.regras ? ui.divisor() : null,
    ui.txt(
      `💰 **Aposta:** ${money.fmt(q.valor)}\n` +
      `🏆 **Prêmio:** ${money.fmt(q.valor * 2 - cfg.taxaPartida)}\n` +
      `❄️ **Modo:** ${fila.GELO[q.gelo] || q.gelo}` +
      (restantes != null ? `\n🎯 **Vagas restantes:** ${restantes}/${q.limite_partidas}` : '')
    ),
    ui.divisor(),
    ui.linhaBotoes(ui.botao(`queue:join:${q.id}:${q.gelo}`, 'DESAFIAR', { estilo: ui.ESTILO.Danger, emoji: '⚔️' })),
    ui.nota('Só um desafiante por vez — quem clicar primeiro joga contra ele.'),
  );
}

async function publicarPainel(client, guildId, q) {
  if (!q.thread_id) return null;
  const thread = await client.channels.fetch(q.thread_id).catch(() => null);
  if (!thread) return null;

  const streamer = streamers.getStreamer(guildId, q.streamer_id);
  const msg = await thread.send(ui.msg(painel(q, streamer)));
  db.prepare('UPDATE queues SET message_id = ? WHERE id = ?').run(msg.id, q.id);
  return msg;
}

async function atualizarPainel(client, guildId, q) {
  if (!q.thread_id) return null;
  try {
    const thread = await client.channels.fetch(q.thread_id);
    if (!thread) return null;
    if (!q.message_id) return publicarPainel(client, guildId, q);

    const msg = await thread.messages.fetch(q.message_id);
    const streamer = streamers.getStreamer(guildId, q.streamer_id);
    await msg.edit(ui.msg(painel(q, streamer)));
    return msg;
  } catch {
    return publicarPainel(client, guildId, q); // mensagem sumiu: publica de novo
  }
}

/**
 * O próprio streamer cria a fila: escolhe canal, valor, gelo, quantas partidas
 * quer jogar (limite opcional) e as regras. Abre um TÓPICO dentro do canal
 * escolhido — é lá que o painel de desafio fica e onde os tickets nascem.
 */
async function abrir(client, guildId, streamerId, canal, { valor, gelo = 'NORMAL', limite = null, regras = null }) {
  await fechar(client, guildId, streamerId);

  const streamer = streamers.getStreamer(guildId, streamerId);
  const nomeThread = `🎥 Live · ${streamer?.titulo || 'desafie o streamer'}`.slice(0, 90);

  const thread = await canal.threads.create({
    name: nomeThread,
    autoArchiveDuration: 1440,
    reason: `Fila exclusiva de streamer aberta por ${streamerId}`,
  });
  await thread.members.add(streamerId).catch(() => {});

  const info = db.prepare(
    `INSERT INTO queues (guild_id, channel_id, thread_id, modalidade, valor, gelo, streamer_id,
                         limite_partidas, regras, ativo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(guildId, canal.id, thread.id, `Live de <@${streamerId}>`, valor, gelo, streamerId, limite, regras, Date.now());

  const q = fila.getQueue(info.lastInsertRowid);
  const entrou = fila.entrarNaFila(q.id, streamerId, gelo);
  await publicarPainel(client, guildId, q);
  return { ok: true, queue: fila.getQueue(q.id), entrou, thread };
}

/** Fecha a fila exclusiva (se existir): devolve o valor travado e arquiva o tópico. */
async function fechar(client, guildId, streamerId) {
  const q = getFilaAtiva(guildId, streamerId);
  if (!q) return null;

  const wallet = require('../lib/wallet');
  const entrada = db.prepare('SELECT * FROM queue_entries WHERE queue_id = ? AND user_id = ?').get(q.id, streamerId);
  if (entrada?.pago) {
    try { wallet.unlock(streamerId, q.valor); } catch { /* trava ja resolvida */ }
  }
  db.prepare('DELETE FROM queue_entries WHERE queue_id = ?').run(q.id);
  db.prepare('UPDATE queues SET ativo = 0 WHERE id = ?').run(q.id);

  if (q.thread_id) {
    try {
      const thread = await client.channels.fetch(q.thread_id);
      if (thread) {
        await thread.send(ui.msg(ui.bloco(cfg.COR.neutro, ui.txt('🔒 Fila encerrada.')))).catch(() => {});
        await thread.setArchived(true).catch(() => {});
      }
    } catch { /* tópico já sumiu */ }
  }
  return q;
}

/**
 * Chamado depois que uma partida da fila exclusiva termina (vitoria ou
 * cancelamento): conta a partida jogada e recoloca o streamer na fila para o
 * proximo desafiante — a menos que o limite de partidas dele tenha acabado,
 * caso em que a fila se fecha sozinha.
 */
async function reseedSeNecessario(client, m) {
  if (!m.queue_id) return;
  const q = fila.getQueue(m.queue_id);
  if (!q || !q.streamer_id || !q.ativo) return;
  if (m.p1 !== q.streamer_id && m.p2 !== q.streamer_id) return;

  const jogadas = (q.partidas_jogadas || 0) + 1;
  db.prepare('UPDATE queues SET partidas_jogadas = ? WHERE id = ?').run(jogadas, q.id);

  if (q.limite_partidas && jogadas >= q.limite_partidas) {
    if (q.thread_id) {
      const thread = await client.channels.fetch(q.thread_id).catch(() => null);
      if (thread) {
        await thread.send(ui.msg(ui.bloco(cfg.COR.neutro,
          ui.titulo('🏁 FILA ENCERRADA'),
          ui.txt(`Limite de ${q.limite_partidas} partida(s) atingido. Valeu a todos que desafiaram!`),
        ))).catch(() => {});
      }
    }
    return fechar(client, q.guild_id, q.streamer_id);
  }

  fila.entrarNaFila(q.id, q.streamer_id, q.gelo);
  await atualizarPainel(client, q.guild_id, fila.getQueue(q.id));
}

module.exports = { getFilaAtiva, abrir, fechar, reseedSeNecessario, painel, publicarPainel, atualizarPainel };
