/**
 * Cache de membros do servidor.
 *
 * `guild.members.fetch()` sem argumento baixa a lista INTEIRA de membros.
 * Isso era chamado a cada partida finalizada (ranking) e a cada chamado de
 * staff (notificar) — com 100+ partidas simultaneas vira rate limit na hora.
 *
 * Com o intent GuildMembers ligado, o gateway mantem o cache atualizado
 * sozinho depois da primeira carga. Entao basta carregar uma vez e revalidar
 * de vez em quando, em vez de baixar tudo a cada uso.
 */

const VALIDADE_MS = 10 * 60 * 1000;
const ultimaCarga = new Map();

/** Devolve a guild com o cache de membros quente. Nao explode se falhar. */
async function comMembros(client, guildId) {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return null;

  const carregadoEm = ultimaCarga.get(guildId) || 0;
  const cacheVazio = guild.members.cache.size <= 1;
  const vencido = Date.now() - carregadoEm > VALIDADE_MS;

  if (cacheVazio || vencido) {
    try {
      await guild.members.fetch();
      ultimaCarga.set(guildId, Date.now());
    } catch (e) {
      console.warn(
        `[membros] nao consegui listar os membros de ${guildId}: ${e.message}\n` +
        '   Confira se o SERVER MEMBERS INTENT esta ligado no portal do Discord.'
      );
    }
  }

  return guild;
}

/** Aquece o cache no boot, para a primeira partida do dia nao pagar o custo. */
async function aquecer(client, guildId) {
  const guild = await comMembros(client, guildId);
  if (guild) console.log(`👥 ${guild.members.cache.size} membro(s) em cache`);
  return guild;
}

/** Forca a proxima chamada a recarregar (usado depois de mexer em cargos em lote). */
const invalidar = (guildId) => ultimaCarga.delete(guildId);

module.exports = { comMembros, aquecer, invalidar, VALIDADE_MS };
