const db = require('../db/database');
const cfg = require('../config');
const gc = require('./guildconfig');

/**
 * Registro de aceite dos termos de uso — prova em caso de contestacao
 * (chargeback) de que o jogador concordou antes de depositar/apostar.
 */
function registrarAceite(userId, guildId, contexto, ref) {
  db.prepare(
    `INSERT INTO termos_aceites (user_id, guild_id, versao, contexto, ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, guildId, cfg.termosVersao, contexto, ref ? String(ref) : null, Date.now());
}

/** Ja aceitou a VERSAO ATUAL dos termos pelo menos uma vez? */
const jaAceitou = (userId, guildId) => !!db.prepare(
  'SELECT 1 FROM termos_aceites WHERE user_id = ? AND guild_id = ? AND versao = ? LIMIT 1'
).get(userId, guildId, cfg.termosVersao);

/** Linha padrao para colar em qualquer painel que precisa do aviso de aceite. */
function linhaAviso(guildId) {
  const canalId = gc.get(guildId, 'canal_termos');
  return canalId
    ? `Ao depositar, você concorda que leu e aceitou os termos em <#${canalId}>.`
    : 'Ao depositar, você concorda com os termos de uso do servidor.';
}

const historico = (userId, guildId, limite = 20) => db.prepare(
  'SELECT * FROM termos_aceites WHERE user_id = ? AND guild_id = ? ORDER BY created_at DESC LIMIT ?'
).all(userId, guildId, limite);

module.exports = { registrarAceite, jaAceitou, linhaAviso, historico };
