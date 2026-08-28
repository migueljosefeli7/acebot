const partida = require('../features/partida');

const REGEX_SALA_CRIADA = /a sala foi criada/i;

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
 * Detecta a mensagem que o bot externo de criação de sala posta no ticket
 * ("A Sala foi criada!", disparada pelo +cs 1/2/3 do sala-bot) e adianta a
 * partida direto para EM_ANDAMENTO, sem esperar alguém clicar em
 * SALA CRIADA · INICIAR.
 */
module.exports = async function onSalaCriada(message) {
  try {
    if (!message.author?.bot || !message.guildId) return;

    const m = partida.getByThread(message.channel.id);
    if (!m || m.status !== 'AGUARDANDO_SALA') return;

    if (!REGEX_SALA_CRIADA.test(textoDaMensagem(message))) return;

    await partida.iniciarPartidaAutomatico(message.client, m.id);
  } catch (e) {
    console.error('[sala-criada]', e.message);
  }
};
