const partida = require('../features/partida');

const REGEX_FINALIZADA = /partida finalizada/i;

/** Junta texto de content, embeds e components (inclusive Components V2) numa string só. */
function textoDaMensagem(message) {
  const partes = [message.content || ''];

  for (const embed of message.embeds || []) {
    partes.push(embed.title || '', embed.description || '');
    for (const f of embed.fields || []) partes.push(f.name || '', f.value || '');
  }

  const percorrer = (comps) => {
    for (const c of comps || []) {
      if (c?.content) partes.push(c.content);
      if (c?.components) percorrer(c.components);
    }
  };
  percorrer(message.components);

  return partes.join('\n');
}

/**
 * Detecta a mensagem que o bot externo de sala posta quando a partida acaba
 * ("Partida Finalizada!", com Time 1/Time 2 e o vencedor) e libera o seletor
 * de "quem venceu" na hora, sem precisar esperar cfg.resultadoLiberaSegundos.
 */
module.exports = async function onPartidaFinalizadaExterna(message) {
  try {
    if (!message.author?.bot || !message.guildId) return;

    const m = partida.getByThread(message.channel.id);
    if (!m || m.status !== 'EM_ANDAMENTO' || m.pronto_pra_resultado) return;

    if (!REGEX_FINALIZADA.test(textoDaMensagem(message))) return;

    await partida.liberarResultado(message.client, m.id);
  } catch (e) {
    console.error('[partida-finalizada-externa]', e.message);
  }
};
