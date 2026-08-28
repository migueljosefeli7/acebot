const db = require('../db/database');

const get = (guildId, key) =>
  db.prepare('SELECT value FROM config WHERE guild_id = ? AND key = ?').get(guildId, key)?.value || null;

const set = (guildId, key, value) =>
  db.prepare(`INSERT INTO config (guild_id, key, value) VALUES (?, ?, ?)
              ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value`).run(guildId, key, value);

const all = (guildId) => {
  const rows = db.prepare('SELECT key, value FROM config WHERE guild_id = ?').all(guildId);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
};

/** Busca um canal configurado; devolve null (sem quebrar) se nao existir mais. */
async function channel(client, guildId, key) {
  const id = get(guildId, key);
  if (!id) return null;
  try {
    const ch = await client.channels.fetch(id);
    return ch || null;
  } catch {
    return null;
  }
}

/** true se o membro tem o cargo configurado, ou e admin do servidor. */
function hasRole(member, key) {
  if (!member) return false;
  if (member.permissions?.has?.('Administrator')) return true;
  const roleId = get(member.guild.id, key);
  return !!roleId && member.roles.cache.has(roleId);
}

module.exports = { get, set, all, channel, hasRole };
