require('dotenv').config();

const int = (v, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};

module.exports = {
  nomeBot: process.env.BOT_NOME || 'ACE',
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,

  // Bot criador de salas: loga com token de conta de usuario (selfbot) e manda
  // +cs 1/2/3 no ticket quando a partida entra em AGUARDANDO_SALA. Vazio = desligado.
  salaBot: {
    token: process.env.SALA_BOT_TOKEN || '',
  },

  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
  iaMaxTokens: int(process.env.IA_MAX_OUTPUT_TOKENS, 500),

  mpAccessToken: process.env.MP_ACCESS_TOKEN,
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  webhookPort: int(process.env.WEBHOOK_PORT, 3000),
  fakePayments: String(process.env.FAKE_PAYMENTS).toLowerCase() === 'true',

  taxaPartida: int(process.env.TAXA_PARTIDA_CENTAVOS, 50),
  depositoMinimo: int(process.env.DEPOSITO_MINIMO_CENTAVOS, 100),
  saqueMinimo: int(process.env.SAQUE_MINIMO_CENTAVOS, 500),
  pixExpiraMinutos: int(process.env.PIX_EXPIRA_MINUTOS, 30),
  // Prazo para quem entrou na fila sem saldo pagar a partida dentro do ticket.
  pagamentoMinutos: int(process.env.PAGAMENTO_PARTIDA_MINUTOS, 15),

  // Rollover (PLD/FT): quanto do que entrou precisa ser jogado antes de sacar.
  rolloverPercentual: int(process.env.ROLLOVER_PERCENTUAL, 80),
  rolloverMinApostas: int(process.env.ROLLOVER_MIN_APOSTAS, 3),
  rolloverMinAdversarios: int(process.env.ROLLOVER_MIN_ADVERSARIOS, 2),

  // Prazo para o adversário confirmar o vencedor antes do bot aceitar a escolha inicial.
  confirmacaoMinutos: int(process.env.CONFIRMACAO_MINUTOS, 5),
  penalidadeNaoConfirmar: int(process.env.PENALIDADE_NAO_CONFIRMAR, 15),

  // Pontos de ranqueada por resultado. Derrota tira pontos, mas nunca deixa negativo.
  pontosVitoria: int(process.env.PONTOS_VITORIA, 25),
  pontosDerrota: int(process.env.PONTOS_DERROTA, 12),

  // Win streak: a partir de quantas vitorias seguidas o bot passa a destacar o jogador.
  streakMinimo: int(process.env.STREAK_MINIMO, 5),

  // B.O / analise de tela: quantas analises um analista toca ao mesmo tempo e
  // quanto tempo uma analise pode durar antes do bot avisar que estourou.
  boMaxAnalisesPorAnalista: int(process.env.BO_MAX_ANALISES_POR_ANALISTA, 2),
  boTempoMaximoMinutos: int(process.env.BO_TEMPO_MAXIMO_MINUTOS, 15),

  // Termos de uso: versao atual (mudou o texto = pede aceite de novo).
  termosVersao: process.env.TERMOS_VERSAO || '1.0',

  // Chaves de configuracao guardadas por servidor (setadas via /config)
  CONFIG_KEYS: {
    canal_tickets: 'Canal onde os tickets de partida sao abertos',
    canal_log_deposito: 'Canal de log de ENTRADA (depositos)',
    canal_log_saque: 'Canal de log de SAIDA (saques) - interno da staff',
    canal_saque_publico: 'Canal PUBLICO onde todo mundo ve quem sacou',
    canal_log_partidas: 'Canal de log de partidas finalizadas',
    canal_saques_staff: 'Canal onde chegam as solicitacoes de saque para aprovar',
    cargo_staff: 'Cargo que resolve disputas e aprova saques',
    cargo_staff_ss: 'Cargo da equipe interna de VAR (legado: staff de SS)',
    cargo_top1: 'Cargo exclusivo do 1o lugar do ranking',
    cargo_top2: 'Cargo exclusivo do 2o lugar do ranking',
    cargo_top3: 'Cargo exclusivo do 3o lugar do ranking',
    canal_ss: 'Canal interno onde a staff recebe os chamados de suporte',
    canal_quebra_regra: 'Canal onde caem as denuncias de quebra de regra',
    canal_sugestoes: 'Canal onde mensagens viram sugestoes com votacao',
    canal_ia: 'Canal onde a IA responde as duvidas dos jogadores',
    canal_ranking: 'Canal do ranking publico (top 10)',
    canal_loja: 'Canal do painel da loja de pontos',
    canal_pedidos_loja: 'Canal onde abrem os tickets de entrega da loja',
    canal_win_streak: 'Canal onde sequencias de vitorias (win streak) sao anunciadas',
    canal_depositos: 'Canal onde abrem os topicos individuais de deposito',
    canal_caixas: 'Canal do painel de caixas (roleta)',
    canal_eventos: 'Canal onde eventos personalizados sao anunciados',
    canal_streamers: 'Canal onde ficam os paineis de fila dos streamers',
    canal_analises: 'Canal interno onde a staff encaminha os casos de VAR',
    canal_transcripts: 'Canal onde os transcripts (HTML) de partida sao postados',
    canal_termos: 'Canal onde os termos de uso completos ficam publicados',
    canal_completar: 'Canal onde +completa/+com/+co e +perfil funcionam (fora do ticket)',
    cargo_analista: 'Cargo dos analistas internos do VAR',
    cargo_streamer: 'Cargo que libera o jogador a criar painel de streamer',
  },

  COR: {
    // Cor oficial da ACE (#ff0101): usada em todos os painéis genéricos.
    primaria: 0xFF0101,
    sucesso: 0x2ECC71,
    erro: 0xE74C3C,
    aviso: 0xF1C40F,
    neutro: 0x2B2D31,
  },
};
