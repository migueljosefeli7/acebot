/**
 * Bot "criador de salas": loga com token de conta de usuario comum (selfbot) e manda
 * +cs 1/2/3 no ticket assim que a partida entra em AGUARDANDO_SALA. Roda como um
 * client separado do bot principal porque usa uma biblioteca e um tipo de token diferentes.
 *
 * Aviso: automatizar uma conta de usuario viola os Termos de Servico do Discord e
 * arrisca banimento da conta usada. Uso por conta e risco de quem configurou o token.
 */
const cfg = require('../config');

let client = null;
let pronto = false;

/**
 * Comando que o self-bot manda pra ferramenta externa criar a sala.
 * Tático sempre manda a palavra "TÁTICO"; o resto manda o símbolo do modo
 * (Misto e qualquer outra coisa cai no # — mesmo símbolo do Gelo Normal).
 */
function comandoSala(m) {
  if ((m.modalidade || '').includes('Tático')) return 'TÁTICO';
  if (m.gelo === 'INFINITO') return '*';
  if (m.gelo === 'FULL_UMP_XM8') return '%';
  return '#';
}

async function iniciar() {
  if (!cfg.salaBot.token) {
    console.log('ℹ️  [sala-bot] SALA_BOT_TOKEN não configurado — recurso desligado.');
    return;
  }

  // Import tardio: se a lib nao estiver instalada e o recurso estiver desligado,
  // o bot principal nao deve quebrar por causa disso.
  let SelfClient;
  try {
    ({ Client: SelfClient } = require('discord.js-selfbot-v13'));
  } catch {
    console.error('❌ [sala-bot] pacote "discord.js-selfbot-v13" não instalado. Rode: npm install');
    return;
  }

  client = new SelfClient({ checkUpdate: false });

  client.once('ready', () => {
    pronto = true;
    console.log(`🎮 [sala-bot] Online como ${client.user.tag}`);
  });

  client.on('error', (e) => console.error('❌ [sala-bot] erro:', e.message));

  try {
    await client.login(cfg.salaBot.token);
  } catch (e) {
    console.error('❌ [sala-bot] falha ao logar com SALA_BOT_TOKEN:', e.message);
    client = null;
  }
}

/** Manda o comando da sala no canal do ticket. Nunca lança — falha aqui não pode travar o bot principal. */
async function enviarComandoSala(channelId, m) {
  if (!pronto || !client) return;
  try {
    const canal = await client.channels.fetch(channelId);
    if (!canal) return;
    await canal.send(comandoSala(m));
  } catch (e) {
    console.error(`❌ [sala-bot] falha ao enviar comando de sala no canal ${channelId}:`, e.message);
  }
}

const getUserId = () => client?.user?.id || null;

module.exports = { iniciar, enviarComandoSala, comandoSala, getUserId };
