const cfg = require('../config');
const gc = require('../lib/guildconfig');
const ia = require('../features/iachat');

const ativos = new Set();
const ultimoUso = new Map();
const COOLDOWN_MS = 4_000;

function dividir(texto, limite = 1900) {
  const partes = [];
  let restante = texto.trim();
  while (restante.length > limite) {
    let corte = restante.lastIndexOf('\n', limite);
    if (corte < limite * 0.55) corte = restante.lastIndexOf(' ', limite);
    if (corte < limite * 0.55) corte = limite;
    partes.push(restante.slice(0, corte).trim());
    restante = restante.slice(corte).trim();
  }
  if (restante) partes.push(restante);
  return partes.slice(0, 4);
}

async function responderErro(message, e) {
  const codigo = e?.status || e?.code;
  let texto = 'Deu uma travada aqui, mano. Tenta de novo daqui a pouco. Se continuar, chama a staff.';
  if (e.message === 'OPENAI_API_KEY_AUSENTE' || codigo === 401) {
    texto = 'A IA ainda não tá configurada certinho. Staff, confere a chave da API no bot.';
  } else if (codigo === 429) {
    texto = 'Tem muita gente perguntando ao mesmo tempo ou o limite da IA acabou. Dá um minutinho e tenta de novo.';
  }
  await message.reply({ content: texto, allowedMentions: { repliedUser: false, parse: [] } }).catch(() => {});
}

module.exports = async function onIaChat(message) {
  if (message.author.bot || message.webhookId || !message.guildId || message.system) return;
  if (message.channelId !== gc.get(message.guildId, 'canal_ia')) return;

  const texto = message.content.trim();
  if (!texto) {
    return message.reply({
      content: 'Manda sua dúvida em texto aí, mano, que eu te ajudo 🤝',
      allowedMentions: { repliedUser: false, parse: [] },
    }).catch(() => {});
  }

  const chave = `${message.guildId}:${message.author.id}`;
  const agora = Date.now();
  if (ativos.has(chave)) {
    return message.react('⏳').catch(() => {});
  }
  if (agora - (ultimoUso.get(chave) || 0) < COOLDOWN_MS) {
    return message.react('⏱️').catch(() => {});
  }

  ativos.add(chave);
  ultimoUso.set(chave, agora);
  const digitando = setInterval(() => message.channel.sendTyping().catch(() => {}), 8_000);

  try {
    await message.channel.sendTyping().catch(() => {});
    const resposta = await ia.criarResposta({
      guildId: message.guildId,
      userId: message.author.id,
      nome: message.member?.displayName || message.author.displayName || message.author.username,
      texto,
    });

    const partes = dividir(resposta);
    for (let i = 0; i < partes.length; i++) {
      const payload = { content: partes[i], allowedMentions: { repliedUser: false, parse: [] } };
      if (i === 0) await message.reply(payload);
      else await message.channel.send(payload);
    }
  } catch (e) {
    console.error('[ia-chat]', e.status || e.code || '', e.message);
    await responderErro(message, e);
  } finally {
    clearInterval(digitando);
    ativos.delete(chave);
  }
};

module.exports.dividir = dividir;
