const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const gc = require('../lib/guildconfig');
const emo = require('../lib/emojis');
const elo = require('./elo');

const REVANCHE_JANELA_MS = 3 * 60 * 60 * 1000; // 3h: duas partidas seguidas entre os mesmos dois

/* ---------------------------------------------------------------- DADOS */

const getEvento = (id) => db.prepare('SELECT * FROM eventos WHERE id = ?').get(id);

const listarAtivos = (guildId) => db.prepare(
  `SELECT * FROM eventos WHERE guild_id = ? AND status = 'ATIVO' AND fim >= ? ORDER BY fim ASC`
).all(guildId, Date.now());

function criarEvento(guildId, {
  nome, tipo, meta, premioPontos = 0, premioTexto, permiteWo = true,
  permiteRevanche = true, exigeConsecutivo = false, duracaoDias = 7, criadoPor,
}) {
  const agora = Date.now();
  const info = db.prepare(
    `INSERT INTO eventos (guild_id, nome, tipo, meta, premio_pontos, premio_texto, permite_wo,
                           permite_revanche, exige_consecutivo, inicio, fim, status, criado_por, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ATIVO', ?, ?)`
  ).run(guildId, nome, tipo, meta, premioPontos, premioTexto || null, permiteWo ? 1 : 0,
    permiteRevanche ? 1 : 0, exigeConsecutivo ? 1 : 0, agora, agora + duracaoDias * 24 * 60 * 60 * 1000,
    criadoPor || null, agora);
  return info.lastInsertRowid;
}

function encerrarEvento(id) {
  db.prepare("UPDATE eventos SET status = 'ENCERRADO' WHERE id = ?").run(id);
}

/* ------------------------------------------------------------- PROGRESSO */

const getProgresso = (eventoId, userId) =>
  db.prepare('SELECT * FROM evento_progresso WHERE evento_id = ? AND user_id = ?').get(eventoId, userId)
  || { evento_id: eventoId, user_id: userId, progresso: 0, concluido: 0 };

const listarProgresso = (guildId, userId) => db.prepare(
  `SELECT e.*, COALESCE(p.progresso, 0) AS progresso, COALESCE(p.concluido, 0) AS concluido
   FROM eventos e LEFT JOIN evento_progresso p ON p.evento_id = e.id AND p.user_id = ?
   WHERE e.guild_id = ? AND e.status = 'ATIVO' AND e.fim >= ? ORDER BY e.fim ASC`
).all(userId, guildId, Date.now());

/** Reseta o progresso de quem quebrou a sequência (perdeu) em eventos de consecutividade. */
const resetarProgresso = db.transaction((eventoId, userId) => {
  db.prepare(
    `INSERT INTO evento_progresso (evento_id, user_id, progresso, concluido, updated_at)
     VALUES (?, ?, 0, 0, ?)
     ON CONFLICT(evento_id, user_id) DO UPDATE SET progresso = 0, updated_at = excluded.updated_at`
  ).run(eventoId, userId, Date.now());
});

/**
 * Soma 1 ao progresso do jogador nesse evento. Se bateu a meta agora (e ainda
 * não estava concluído), credita o prêmio em pontos e avisa quem chamou.
 */
const incrementarProgresso = db.transaction((evento, userId) => {
  const atual = getProgresso(evento.id, userId);
  if (atual.concluido) return { concluiuAgora: false, progresso: atual.progresso };

  const novo = atual.progresso + 1;
  const concluiu = novo >= evento.meta;

  db.prepare(
    `INSERT INTO evento_progresso (evento_id, user_id, progresso, concluido, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(evento_id, user_id) DO UPDATE SET progresso = excluded.progresso,
       concluido = excluded.concluido, updated_at = excluded.updated_at`
  ).run(evento.id, userId, novo, concluiu ? 1 : 0, Date.now());

  if (concluiu && evento.premio_pontos > 0) {
    elo.darPontos(userId, evento.premio_pontos, `Concluiu o evento "${evento.nome}"`, `evento:${evento.id}`);
  }

  return { concluiuAgora: concluiu, progresso: novo };
});

/* ---------------------------------------------------------------- DETECCAO */

/** Duas partidas entre o mesmo par, uma logo depois da outra: revanche. */
function ehRevanche(m) {
  const anterior = db.prepare(
    `SELECT id FROM matches WHERE guild_id = ? AND id != ? AND status = 'FINALIZADA'
       AND ((p1 = ? AND p2 = ?) OR (p1 = ? AND p2 = ?))
       AND finished_at >= ? AND finished_at < ?
     ORDER BY finished_at DESC LIMIT 1`
  ).get(m.guild_id, m.id, m.p1, m.p2, m.p2, m.p1, m.created_at - REVANCHE_JANELA_MS, m.created_at);
  return !!anterior;
}

/**
 * Chamado a cada partida finalizada (inclusive W.O.). Atualiza o progresso de
 * todo evento ativo do servidor e devolve o que foi concluído agora, para
 * anunciar no canal de eventos.
 */
function registrarResultado(guildId, vencedorId, perdedorId, m, motivo = '') {
  const viaWO = /w\.?o\.?/i.test(motivo);
  const viaRevanche = ehRevanche(m);
  const concluidos = [];

  for (const evento of listarAtivos(guildId)) {
    const ladoGanhador = evento.tipo === 'VITORIAS' ? vencedorId : perdedorId;
    const ladoPerdedor = evento.tipo === 'VITORIAS' ? perdedorId : vencedorId;

    const bloqueadoPorWo = viaWO && !evento.permite_wo;
    const bloqueadoPorRevanche = viaRevanche && !evento.permite_revanche;

    if (!bloqueadoPorWo && !bloqueadoPorRevanche) {
      const r = incrementarProgresso(evento, ladoGanhador);
      if (r.concluiuAgora) concluidos.push({ evento, userId: ladoGanhador });
    }

    if (evento.exige_consecutivo) resetarProgresso(evento.id, ladoPerdedor);
  }

  return { viaWO, viaRevanche, concluidos };
}

/** Avisa no canal_eventos quem bateu a meta. */
async function anunciarConclusoes(client, guildId, concluidos) {
  if (!concluidos.length) return;
  const canal = await gc.channel(client, guildId, 'canal_eventos');
  if (!canal) return;

  for (const { evento, userId } of concluidos) {
    await canal.send(ui.msg(ui.bloco(cfg.COR.sucesso,
      ui.titulo(`${emo.evento} EVENTO CONCLUÍDO`),
      ui.divisor(),
      ui.txt(`<@${userId}> completou **${evento.nome}**!`),
      evento.premio_pontos > 0 ? ui.nota(`Recompensa: +${evento.premio_pontos} pontos`) : null,
      evento.premio_texto ? ui.txt(`🎁 ${evento.premio_texto}`) : null,
    ))).catch(() => {});
  }
}

/** Roda depois de toda partida finalizada (chamada por partida.js, nunca deve derrubar o fluxo). */
async function registrar(client, guildId, vencedorId, perdedorId, m, motivo) {
  const r = registrarResultado(guildId, vencedorId, perdedorId, m, motivo);
  await anunciarConclusoes(client, guildId, r.concluidos);
  return r;
}

/* ---------------------------------------------------------------- PAINEL */

const TIPO_LABEL = { VITORIAS: 'Vitórias', DERROTAS: 'Derrotas' };

function linhaEvento(evento, progresso) {
  const restante = Math.max(0, evento.meta - (progresso ?? 0));
  const flags = [
    evento.exige_consecutivo ? '🔗 consecutivo' : null,
    !evento.permite_wo ? '🚫 W.O. não conta' : null,
    !evento.permite_revanche ? '🚫 revanche não conta' : null,
  ].filter(Boolean).join(' · ');

  return `**${evento.nome}** \`#${evento.id}\` — ${TIPO_LABEL[evento.tipo]} até \`${evento.meta}\`` +
    (progresso != null ? ` · progresso \`${progresso}/${evento.meta}\`` : '') +
    (flags ? `\n└ ${flags}` : '') +
    `\n└ termina <t:${Math.floor(evento.fim / 1000)}:R>`;
}

function painelListagem(guildId) {
  const ativos = listarAtivos(guildId);
  return ui.bloco(cfg.COR.primaria,
    ui.titulo(`${emo.evento} EVENTOS ATIVOS`),
    ui.divisor(),
    ativos.length ? ui.txt(ativos.map((e) => linhaEvento(e)).join('\n\n')) : ui.txt('_Nenhum evento ativo no momento._'),
    ui.divisor(),
    ui.linhaBotoes(
      ui.botao('evento:meu', 'MEU PROGRESSO', { estilo: ui.ESTILO.Primary, emoji: '📊' }),
      ui.botao('evento:atualizar', 'ATUALIZAR', { emoji: '🔄' }),
    ),
  );
}

function painelMeuProgresso(guildId, userId) {
  const lista = listarProgresso(guildId, userId);
  return ui.bloco(cfg.COR.primaria,
    ui.titulo(`${emo.evento} MEU PROGRESSO`),
    ui.divisor(),
    lista.length ? ui.txt(lista.map((e) => linhaEvento(e, e.progresso)).join('\n\n')) : ui.txt('_Nenhum evento ativo no momento._'),
  );
}

/** Publica ou reescreve o painel fixo de eventos no canal configurado. */
async function publicarPainel(client, guildId) {
  const canal = await gc.channel(client, guildId, 'canal_eventos');
  if (!canal) return null;

  const msgId = gc.get(guildId, 'mensagem_eventos');
  try {
    if (msgId) {
      const msg = await canal.messages.fetch(msgId);
      await msg.edit(ui.msg(painelListagem(guildId)));
      return msg;
    }
  } catch { /* mensagem apagada: publica de novo */ }

  const nova = await canal.send(ui.msg(painelListagem(guildId)));
  gc.set(guildId, 'mensagem_eventos', nova.id);
  return nova;
}

module.exports = {
  getEvento, listarAtivos, criarEvento, encerrarEvento,
  getProgresso, listarProgresso, ehRevanche, registrarResultado, registrar, anunciarConclusoes,
  painelListagem, painelMeuProgresso, publicarPainel, REVANCHE_JANELA_MS,
};
