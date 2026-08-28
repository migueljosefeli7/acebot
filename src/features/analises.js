const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const gc = require('../lib/guildconfig');
const emo = require('../lib/emojis');

const getAnalise = (id) => db.prepare('SELECT * FROM analises WHERE id = ?').get(id);

const listarFila = (guildId) =>
  db.prepare("SELECT * FROM analises WHERE guild_id = ? AND status = 'FILA' ORDER BY created_at ASC").all(guildId);

const listarEmAndamento = (analistaId) =>
  db.prepare("SELECT * FROM analises WHERE analista_id = ? AND status = 'EM_ANDAMENTO' ORDER BY iniciada_em ASC").all(analistaId);

/** Análises que estouraram o prazo máximo e ainda estão em andamento. */
const analisesVencidas = (guildId) => db.prepare(
  `SELECT * FROM analises WHERE guild_id = ? AND status = 'EM_ANDAMENTO'
     AND prazo_minutos IS NOT NULL AND iniciada_em + (prazo_minutos * 60000) < ?`
).all(guildId, Date.now());

/** Cria a entrada na fila interna quando a própria staff chama o VAR. */
function abrirAnalise(matchId, guildId) {
  const info = db.prepare(
    `INSERT INTO analises (match_id, guild_id, status, created_at) VALUES (?, ?, 'FILA', ?)`
  ).run(matchId, guildId, Date.now());
  return info.lastInsertRowid;
}

/**
 * Um analista assume a análise: trava a quantidade máxima simultânea
 * (cfg.boMaxAnalisesPorAnalista) para ninguém sobrecarregar sozinho a fila.
 */
const assumir = db.transaction((analiseId, analistaId) => {
  const analise = getAnalise(analiseId);
  if (!analise) return { erro: 'NAO_EXISTE' };
  if (analise.status !== 'FILA') return { erro: 'JA_ASSUMIDA' };

  const emAndamento = listarEmAndamento(analistaId).length;
  if (emAndamento >= cfg.boMaxAnalisesPorAnalista) {
    return { erro: 'LIMITE_ATINGIDO', limite: cfg.boMaxAnalisesPorAnalista };
  }

  db.prepare(
    `UPDATE analises SET status = 'EM_ANDAMENTO', analista_id = ?, iniciada_em = ?, prazo_minutos = ? WHERE id = ?`
  ).run(analistaId, Date.now(), cfg.boTempoMaximoMinutos, analiseId);

  return { ok: true, analise: getAnalise(analiseId) };
});

function concluir(analiseId) {
  db.prepare("UPDATE analises SET status = 'CONCLUIDA', concluida_em = ? WHERE id = ? AND status != 'CONCLUIDA'")
    .run(Date.now(), analiseId);
}

/** Fecha automaticamente qualquer análise pendente de uma partida (veredito deu, W.O., etc). */
function concluirPorMatch(matchId) {
  db.prepare(
    "UPDATE analises SET status = 'CONCLUIDA', concluida_em = ? WHERE match_id = ? AND status IN ('FILA', 'EM_ANDAMENTO')"
  ).run(Date.now(), matchId);
}

function marcarWo(analiseId) {
  db.prepare("UPDATE analises SET status = 'WO', concluida_em = ? WHERE id = ?").run(Date.now(), analiseId);
}

/* ---------------------------------------------------------------- PAINEL */

function painelFila(guildId) {
  const fila = listarFila(guildId);
  const vencidas = analisesVencidas(guildId);

  return ui.bloco(vencidas.length ? cfg.COR.erro : cfg.COR.primaria,
    ui.titulo(`${emo.relogio} FILA INTERNA DO VAR`),
    ui.nota(`${fila.length} aguardando · limite de ${cfg.boMaxAnalisesPorAnalista} por analista · prazo de ${cfg.boTempoMaximoMinutos} min`),
    ui.divisor(),
    fila.length
      ? ui.txt(fila.map((a) => `\`#${a.id}\` Partida #${a.match_id} — aguardando desde <t:${Math.floor(a.created_at / 1000)}:R>`).join('\n'))
      : ui.txt('_Fila vazia._'),
    vencidas.length ? ui.txt(`⚠️ ${vencidas.length} análise(s) passaram do prazo máximo e precisam de atenção.`) : null,
  );
}

function painelMinhasAnalises(analistaId) {
  const minhas = listarEmAndamento(analistaId);
  return ui.bloco(cfg.COR.primaria,
    ui.titulo(`${emo.relogio} MINHAS ANÁLISES`),
    ui.nota(`${minhas.length}/${cfg.boMaxAnalisesPorAnalista} em andamento`),
    ui.divisor(),
    minhas.length
      ? ui.txt(minhas.map((a) => `\`#${a.id}\` Partida #${a.match_id} — iniciada <t:${Math.floor(a.iniciada_em / 1000)}:R>`).join('\n'))
      : ui.txt('_Nenhuma análise em andamento._'),
  );
}

module.exports = {
  getAnalise, listarFila, listarEmAndamento, analisesVencidas,
  abrirAnalise, assumir, concluir, concluirPorMatch, marcarWo,
  painelFila, painelMinhasAnalises,
};
