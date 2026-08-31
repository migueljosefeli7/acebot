const partida = require('../features/partida');

const REGEX_GO = /^\+go\b/i;

/**
 * "+go" no ticket: um dos dois jogadores confirma que está pronto pra
 * começar depois que a sala foi criada. Quando os dois confirmarem, a
 * partida entra em EM_ANDAMENTO de verdade (ver partida.registrarGo).
 */
module.exports = async function onGoPartida(message) {
  try {
    if (message.author?.bot || !message.guildId) return;
    if (!REGEX_GO.test(message.content.trim())) return;

    const m = partida.getByThread(message.channel.id);
    if (!m || m.status !== 'SALA_CRIADA') return;

    await partida.registrarGo(message.client, m.id, message.author.id);
  } catch (e) {
    console.error('[go-partida]', e.message);
  }
};
