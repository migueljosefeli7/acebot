const cfg = require('../config');
const ui = require('./ui');
const gc = require('./guildconfig');

/**
 * Controle de rate limit.
 *
 * Quando o Discord aplica limite, o bot para de ABRIR partidas novas em vez de
 * ficar empilhando requisicao e travando tudo. Partidas ja abertas continuam
 * funcionando normalmente — o que pausa e so a criacao de topico novo, que e a
 * operacao mais cara e a primeira a estourar em horario de pico.
 */

// Rotas que realmente importam: criar topico e mandar mensagem.
const ROTA_CRITICA = /threads|messages/i;

let pausadoAte = 0;
let ultimoAviso = 0;
let totalEventos = 0;
let clientRef = null;

const MARGEM_MS = 500;              // folga sobre o tempo que o Discord pediu
const INTERVALO_AVISO_MS = 60_000;  // nao spamma a staff a cada evento

const estaPausado = () => Date.now() < pausadoAte;
const faltaMs = () => Math.max(0, pausadoAte - Date.now());

const estado = () => ({
  pausado: estaPausado(),
  faltaMs: faltaMs(),
  totalEventos,
});

/** Avisa a staff, no maximo uma vez por minuto. */
async function avisarStaff(guildId, segundos) {
  if (!clientRef || !guildId) return;
  if (Date.now() - ultimoAviso < INTERVALO_AVISO_MS) return;
  ultimoAviso = Date.now();

  const canal = await gc.channel(clientRef, guildId, 'canal_log_partidas');
  if (!canal) return;

  await canal.send(ui.msg(ui.bloco(cfg.COR.aviso,
    ui.titulo('⏳ LIMITE DO DISCORD ATINGIDO'),
    ui.divisor(),
    ui.txt(
      `A criação de **novas partidas** está pausada por ~${segundos}s para o bot não travar.\n\n` +
      'Partidas já abertas seguem funcionando normalmente. ' +
      'Quem entrar na fila agora só espera a fila voltar.'
    ),
    ui.nota(`${totalEventos} evento(s) de rate limit desde que o bot subiu`),
  ))).catch(() => {});
}

/** Liga o listener do discord.js. Chamar uma vez, no boot. */
function instalar(client) {
  clientRef = client;

  client.rest.on('rateLimited', (info) => {
    totalEventos += 1;

    const critica = ROTA_CRITICA.test(info.route || '') || info.global;
    const espera = (info.timeToReset || 0) + MARGEM_MS;

    // Limite global ou em rota critica: segura a criacao de partida nova.
    if (critica && espera > 0) {
      pausadoAte = Math.max(pausadoAte, Date.now() + espera);
      const seg = Math.ceil(espera / 1000);
      console.warn(
        `[rate-limit] ${info.global ? 'GLOBAL' : info.route} — pausando novas partidas por ${seg}s`
      );
      avisarStaff(cfg.guildId, seg);
    }
  });

  console.log('🛡️  Controle de rate limit ativo');
}

/** Resposta pronta para quem tentou entrar na fila durante a pausa. */
const respostaPausado = () => ui.msg(ui.bloco(cfg.COR.aviso,
  ui.titulo('⏳ FILA MOMENTANEAMENTE CHEIA'),
  ui.divisor(),
  ui.txt(
    'O Discord está limitando o bot agora por causa do volume de partidas.\n\n' +
    `Tente de novo em **${Math.ceil(faltaMs() / 1000)} segundos** — ` +
    'seu saldo não foi tocado.'
  ),
), { efemero: true });

module.exports = { instalar, estaPausado, faltaMs, estado, respostaPausado };
