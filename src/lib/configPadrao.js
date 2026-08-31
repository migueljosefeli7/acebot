/**
 * Canais e cargos fixos do servidor oficial — definidos aqui em código pra
 * nunca mais precisar rodar /config depois de um restart ou de recriar o
 * banco do zero. Uma vez configurado, `/config canal`/`/config cargo` ainda
 * funciona normalmente pra ajustar algo pontual (só sobrescreve o que já
 * está salvo no banco quando o valor daqui ainda não existe lá).
 */

const GUILD_ID = '1541905325895065671';

const DEFAULTS = {
  // ---- canais principais ----
  canal_tickets: '1541922401443520532',
  canal_depositos: '1541934174015987802',
  canal_saques_staff: '1544028794413650081',
  canal_saque_publico: '1541934331944108103',

  // ---- suporte e VAR ----
  canal_ss: '1541928558564479097',
  canal_analises: '1541928960328204308',
  canal_transcripts: '1544029026488680548',

  // ---- logs ----
  canal_log_deposito: '1541946708437504091',
  canal_log_saque: '1544028794413650081',
  canal_log_partidas: '1544029169065791708',

  // ---- sistemas publicos ----
  canal_sugestoes: '1542367991088418857',
  canal_ia: '1544029298284036237',
  canal_ranking: '1541931923067113512',
  canal_loja: '1541968863678300240',
  canal_pedidos_loja: '1544029488185344040',
  canal_win_streak: '1542368238875447327',
  canal_caixas: '1544029526852632718',
  canal_eventos: '1541927836385026159',
  canal_streamers: '1544029685770362990',
  canal_termos: '1544029828552859828',
  canal_completar: '1542380148194680913',

  // ---- cargos ----
  cargo_staff: '1541927968010407936',
  cargo_analista: '1541926553779310622',
  cargo_streamer: '1544030034719678535',
  cargo_top1: '1544030118413078679',
  cargo_top2: '1544030267222663238',
  cargo_top3: '1544030310679715891',
};

/**
 * Grava no banco todo default que ainda não tem valor salvo pro servidor.
 * Idempotente e seguro pra rodar em todo boot: nunca sobrescreve um valor
 * que já foi ajustado manualmente via /config.
 */
function seed(guildId = GUILD_ID) {
  const gc = require('./guildconfig');
  let gravados = 0;

  for (const [chave, valor] of Object.entries(DEFAULTS)) {
    if (!gc.get(guildId, chave)) {
      gc.set(guildId, chave, valor);
      gravados++;
    }
  }

  return gravados;
}

module.exports = { GUILD_ID, DEFAULTS, seed };
