const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Collection, Partials, REST, Routes, Events } = require('discord.js');

const cfg = require('./config');
const db = require('./db/database');
const fila = require('./features/fila');
const partida = require('./features/partida');
const ranking = require('./features/ranking');
const handleInteraction = require('./interactions');
const onSugestao = require('./events/sugestao');
const onCompletar = require('./events/completar');
const onIaChat = require('./events/iaChat');
const membros = require('./lib/membros');
const ratelimit = require('./lib/ratelimit');
const { iniciarWebhook } = require('./web/server');

if (!cfg.token || !cfg.clientId) {
  console.error('❌ Faltou DISCORD_TOKEN ou CLIENT_ID no arquivo .env');
  process.exit(1);
}
if (!cfg.fakePayments && !cfg.mpAccessToken) {
  console.error('❌ MP_ACCESS_TOKEN não configurado. Preencha no .env ou ligue FAKE_PAYMENTS=true para testar.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    // Necessario para chamar no privado todo mundo que tem o cargo de staff/SS.
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

/* ------------------------------------------------------------- COMANDOS */

client.commands = new Collection();
const dir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const cmd = require(path.join(dir, file));
  if (cmd?.data && cmd?.execute) client.commands.set(cmd.data.name, cmd);
  else console.warn(`[comandos] ${file} ignorado (faltou data/execute)`);
}

async function registrarComandos() {
  const rest = new REST().setToken(cfg.token);
  const body = client.commands.map((c) => c.data.toJSON());
  if (cfg.guildId) {
    await rest.put(Routes.applicationGuildCommands(cfg.clientId, cfg.guildId), { body });
    console.log(`✅ ${body.length} comandos registrados no servidor ${cfg.guildId}`);
  } else {
    await rest.put(Routes.applicationCommands(cfg.clientId), { body });
    console.log(`✅ ${body.length} comandos registrados globalmente (pode levar até 1h para aparecer)`);
  }
}

/* --------------------------------------------------------------- STARTUP */

ratelimit.instalar(client);

client.once(Events.ClientReady, async () => {
  console.log(`🤖 Online como ${client.user.tag}`);
  client.user.setActivity('apostas de Free Fire 🎮');

  try {
    await registrarComandos();
  } catch (e) {
    console.error('❌ Falha ao registrar comandos:', e.message);
  }

  // Se o processo caiu logo após o segundo jogador responder o resultado,
  // conclui a partida de forma idempotente e libera os jogadores para a fila.
  const recuperadas = await partida.recuperarResultadosPendentes(client);
  if (recuperadas.verificadas) {
    console.log(
      `🏁 Resultados recuperados: ${recuperadas.finalizadas} finalizada(s), ` +
      `${recuperadas.disputas} disputa(s), ${recuperadas.erros} erro(s)`
    );
  }

  // Reescreve os paineis de fila para refletir o estado real do banco depois de um restart.
  const filas = db.prepare('SELECT id FROM queues WHERE ativo = 1 AND message_id IS NOT NULL').all();
  for (const q of filas) await fila.atualizarPainel(client, q.id);
  if (filas.length) console.log(`🔄 ${filas.length} painel(is) de fila sincronizado(s)`);

  // Também aplica a arte da modalidade aos tickets ativos que já existiam.
  const partidasAtivas = db.prepare(
    "SELECT id FROM matches WHERE thread_id IS NOT NULL AND status NOT IN ('FINALIZADA', 'CANCELADA')"
  ).all();
  for (const m of partidasAtivas) await partida.atualizarPainel(client, m.id);
  if (partidasAtivas.length) console.log(`🖼️ ${partidasAtivas.length} painel(is) de partida sincronizado(s)`);

  // Aquece o cache de membros uma vez: sem isso, a primeira partida do dia
  // pagaria o custo de baixar a lista inteira de membros.
  if (cfg.guildId) await membros.aquecer(client, cfg.guildId);

  if (cfg.fakePayments) console.log('⚠️  MODO TESTE DE PAGAMENTO LIGADO — nenhum PIX real é gerado.');
});

client.on(Events.InteractionCreate, handleInteraction);
client.on(Events.MessageCreate, onSugestao);
client.on(Events.MessageCreate, onCompletar);
client.on(Events.MessageCreate, onIaChat);

/* ------------------------------------------------- LIMPEZA DE PENDENCIAS */

// Marca como expirados os PIX que passaram do prazo sem pagamento.
setInterval(() => {
  const info = db.prepare("UPDATE deposits SET status = 'EXPIRADO' WHERE status = 'PENDENTE' AND expires_at < ?")
    .run(Date.now());
  if (info.changes) console.log(`🧹 ${info.changes} cobrança(s) PIX expirada(s)`);
}, 5 * 60 * 1000);

// Cancela partidas onde alguem entrou sem saldo e nao pagou no prazo.
// Quem chegou a pagar recebe o valor de volta.
setInterval(async () => {
  const limite = Date.now() - cfg.pagamentoMinutos * 60 * 1000;
  const vencidas = db.prepare(
    "SELECT id FROM matches WHERE status = 'AGUARDANDO_PAGAMENTO' AND created_at < ?"
  ).all(limite);

  for (const { id } of vencidas) {
    try {
      await partida.cancelarPartida(client, id,
        `Pagamento não foi feito dentro do prazo de ${cfg.pagamentoMinutos} minutos.`);
      console.log(`⏱️ Partida #${id} cancelada por falta de pagamento.`);
    } catch (e) {
      console.error(`[prazo] falha ao cancelar partida #${id}:`, e.message);
    }
  }

  // Partida onde um declarou o resultado e o outro sumiu: decide sozinho.
  try {
    const r = await partida.resolverAbandonos(client);
    if (r.resolvidas) console.log(`⏱️ ${r.resolvidas} partida(s) resolvida(s) por abandono de confirmação.`);
  } catch (e) {
    console.error('[abandono] varredura falhou:', e.message);
  }

  // Ranking diario/semanal/mensal: cada chamada so posta de verdade quando a
  // janela correspondente ja virou (checagem fica dentro de postarAutomatico).
  if (cfg.guildId) {
    try {
      await ranking.postarAutomatico(client, cfg.guildId);
    } catch (e) {
      console.error('[ranking] auto-post falhou:', e.message);
    }
  }
}, 60 * 1000);

/* ------------------------------------------------------------ SEGURANCA */

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    console.log('\n👋 Desligando...');
    try { db.close(); } catch { /* ja fechado */ }
    client.destroy();
    process.exit(0);
  });
}

iniciarWebhook(client);
client.login(cfg.token);
