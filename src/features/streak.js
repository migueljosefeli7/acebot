const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const gc = require('../lib/guildconfig');
const money = require('../lib/money');

// Cor especifica de win streak: laranja, para diferenciar da cor padrao ACE
// nos tickets quando um jogador em sequencia esta jogando.
const COR_STREAK = 0xFF8C00;

const getStreak = (userId) => {
  const u = db.prepare('SELECT streak_atual, streak_recorde FROM users WHERE discord_id = ?').get(userId);
  return u ? { atual: u.streak_atual, recorde: u.streak_recorde } : { atual: 0, recorde: 0 };
};

/** Quantas vitorias seguidas o jogador precisa ter para aparecer destacado. */
const emDestaque = (userId) => getStreak(userId).atual >= cfg.streakMinimo;

/**
 * Atualiza os dois lados apos uma partida: vencedor sobe streak, perdedor
 * zera. Devolve o que mudou para o chamador decidir se anuncia.
 */
const atualizar = db.transaction((vencedorId, perdedorId) => {
  db.prepare(
    `UPDATE users SET streak_atual = streak_atual + 1,
     streak_recorde = MAX(streak_recorde, streak_atual + 1) WHERE discord_id = ?`
  ).run(vencedorId);

  const streakQuebrado = getStreak(perdedorId).atual;
  db.prepare('UPDATE users SET streak_atual = 0 WHERE discord_id = ?').run(perdedorId);

  return { streakVencedor: getStreak(vencedorId).atual, streakQuebrado };
});

/** Anuncia no canal dedicado quando alguem bate ou quebra uma sequencia relevante. */
async function anunciar(client, guildId, { vencedorId, perdedorId, streakVencedor, streakQuebrado, m }) {
  const canal = await gc.channel(client, guildId, 'canal_win_streak');
  if (!canal) return;

  if (streakVencedor >= cfg.streakMinimo) {
    await canal.send(ui.msg(ui.bloco(cfg.COR.primaria,
      ui.titulo('🔥 WIN STREAK'),
      ui.divisor(),
      ui.txt(`<@${vencedorId}> atingiu **${streakVencedor} vitórias seguidas** sem perder! 🔥`),
      m ? ui.nota(`Partida #${m.id} · ${m.modalidade} · ${money.fmt(m.valor)}`) : null,
    ))).catch(() => {});
  }

  if (streakQuebrado >= cfg.streakMinimo) {
    await canal.send(ui.msg(ui.bloco(cfg.COR.primaria,
      ui.titulo('💔 SEQUÊNCIA QUEBRADA'),
      ui.divisor(),
      ui.txt(`<@${perdedorId}> perdeu uma sequência de **${streakQuebrado} vitórias** para <@${vencedorId}>.`),
      m ? ui.nota(`Partida #${m.id} · ${m.modalidade}`) : null,
    ))).catch(() => {});
  }
}

/** Roda tudo (atualiza + anuncia) — chamado de dentro de pontuarPartida. */
async function registrar(client, guildId, vencedorId, perdedorId, m) {
  const r = atualizar(vencedorId, perdedorId);
  await anunciar(client, guildId, { vencedorId, perdedorId, ...r, m });
  return r;
}

/** Linha "🔥N" para exibir ao lado do nome de quem esta em streak. Vazio se nao estiver. */
const tagStreak = (userId) => {
  const s = getStreak(userId);
  return s.atual >= cfg.streakMinimo ? ` 🔥${s.atual}` : '';
};

module.exports = { getStreak, emDestaque, registrar, tagStreak, COR_STREAK };
