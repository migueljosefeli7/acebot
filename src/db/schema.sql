PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Carteira do jogador. Tudo em CENTAVOS (inteiro), nunca float.
CREATE TABLE IF NOT EXISTS users (
  discord_id   TEXT PRIMARY KEY,
  balance      INTEGER NOT NULL DEFAULT 0,   -- saldo livre
  locked       INTEGER NOT NULL DEFAULT 0,   -- saldo travado (em fila / em partida / em saque)
  total_in     INTEGER NOT NULL DEFAULT 0,
  total_out    INTEGER NOT NULL DEFAULT 0,
  wins         INTEGER NOT NULL DEFAULT 0,
  losses       INTEGER NOT NULL DEFAULT 0,
  banned       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

-- Extrato imutavel de tudo que mexe em saldo.
CREATE TABLE IF NOT EXISTS transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  type        TEXT NOT NULL,   -- DEPOSITO | SAQUE | SAQUE_ESTORNO | APOSTA | PREMIO | ESTORNO | TAXA | ADMIN_ADD | ADMIN_REMOVE
  amount      INTEGER NOT NULL, -- positivo credita, negativo debita
  balance_after INTEGER NOT NULL,
  description TEXT,
  ref         TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS deposits (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL,
  amount       INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'PENDENTE',  -- PENDENTE | PAGO | EXPIRADO | CANCELADO
  mp_payment_id TEXT,
  match_id     INTEGER,                        -- cobranca de uma partida especifica
  finalidade   TEXT NOT NULL DEFAULT 'SALDO',   -- SALDO | PARTIDA
  qr_code      TEXT,
  ticket_url   TEXT,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER,
  paid_at      INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dep_mp ON deposits(mp_payment_id) WHERE mp_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS withdrawals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL,
  amount       INTEGER NOT NULL,
  pix_key      TEXT NOT NULL,
  holder_name  TEXT,
  status       TEXT NOT NULL DEFAULT 'PENDENTE', -- PENDENTE | PAGO | RECUSADO
  staff_id     TEXT,
  reason       TEXT,
  message_id   TEXT,
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER
);

-- Cada painel de fila postado num canal (modalidade + valor).
CREATE TABLE IF NOT EXISTS queues (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  modalidade TEXT NOT NULL,     -- ex: 1x1 Mobile
  valor      INTEGER NOT NULL,  -- centavos
  banner     TEXT,
  ativo      INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- Quem esta na fila agora. Um jogador so pode estar em 1 fila por vez.
CREATE TABLE IF NOT EXISTS queue_entries (
  queue_id  INTEGER NOT NULL,
  user_id   TEXT NOT NULL,
  gelo      TEXT NOT NULL,  -- INFINITO | NORMAL
  pago      INTEGER NOT NULL DEFAULT 0,  -- 1 = ja travou o valor ao entrar
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (queue_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qe_user ON queue_entries(user_id);

CREATE TABLE IF NOT EXISTS matches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  queue_id     INTEGER,
  modalidade   TEXT NOT NULL,
  gelo         TEXT NOT NULL,
  valor        INTEGER NOT NULL,
  taxa         INTEGER NOT NULL,
  p1           TEXT NOT NULL,
  p2           TEXT NOT NULL,
  thread_id    TEXT,
  status       TEXT NOT NULL,   -- AGUARDANDO_REGRAS | REGRA_PROPOSTA | AGUARDANDO_SALA | EM_ANDAMENTO | AGUARDANDO_RECRIACAO | REVISAO | AGUARDANDO_RESULTADO | SS_SOLICITADO | DISPUTA | FINALIZADA | CANCELADA
  regras       TEXT,
  regras_autor TEXT,
  winner_id    TEXT,
  pago_p1      INTEGER NOT NULL DEFAULT 0,  -- 1 = valor do jogador 1 garantido
  pago_p2      INTEGER NOT NULL DEFAULT 0,
  claim_p1     TEXT,            -- ID do vencedor escolhido pelo jogador 1
  claim_p2     TEXT,            -- ID do vencedor escolhido pelo jogador 2
  proof_p1     TEXT,
  proof_p2     TEXT,
  staff_id     TEXT,
  cancel_req   TEXT,           -- quem pediu cancelamento (precisa dos 2)
  ss_por       TEXT,           -- quem pediu tela
  ss_nicks     TEXT,           -- nick(s) informado(s) de quem sera telado
  recriacoes   INTEGER NOT NULL DEFAULT 0,  -- quantas vezes a sala foi refeita
  recriar_p1   INTEGER NOT NULL DEFAULT 0,  -- ja pagou a taxa da recriacao atual
  recriar_p2   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  finished_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_match_thread ON matches(thread_id);

-- Propostas de revanche feitas depois que uma partida termina. A revanche usa
-- o mesmo ticket, mas nasce como uma nova partida para manter saldo, resultado
-- e histórico financeiro separados da partida anterior.
CREATE TABLE IF NOT EXISTS revanche_propostas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id     INTEGER NOT NULL,
  guild_id     TEXT NOT NULL,
  thread_id    TEXT NOT NULL,
  proposer_id  TEXT NOT NULL,
  opponent_id  TEXT NOT NULL,
  amount       INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'PENDENTE', -- PENDENTE | ACEITA | RECUSADA | EXPIRADA
  new_match_id INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_revanche_match ON revanche_propostas(match_id, status);

CREATE TABLE IF NOT EXISTS config (
  guild_id TEXT NOT NULL,
  key      TEXT NOT NULL,
  value    TEXT,
  PRIMARY KEY (guild_id, key)
);

-- Vouchers de saldo criados pela staff (promocao, premiacao, reembolso).
CREATE TABLE IF NOT EXISTS vouchers (
  code       TEXT PRIMARY KEY,            -- sempre em MAIUSCULO
  guild_id   TEXT NOT NULL,
  amount     INTEGER NOT NULL,            -- centavos creditados por resgate
  max_uses   INTEGER NOT NULL DEFAULT 1,
  uses       INTEGER NOT NULL DEFAULT 0,
  restrito_a TEXT,                        -- discord id, ou NULL = qualquer um
  descricao  TEXT,
  criado_por TEXT NOT NULL,
  ativo      INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Um resgate por jogador por voucher. A PK ja impede resgate duplicado.
CREATE TABLE IF NOT EXISTS voucher_uses (
  code    TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount  INTEGER NOT NULL,
  used_at INTEGER NOT NULL,
  PRIMARY KEY (code, user_id)
);

-- ============================ PONTOS, ELO E LOJA ============================

-- Cargo do Discord ligado a cada elo (ex: OURO_2 -> role id).
CREATE TABLE IF NOT EXISTS elo_cargos (
  guild_id TEXT NOT NULL,
  elo      TEXT NOT NULL,
  role_id  TEXT NOT NULL,
  PRIMARY KEY (guild_id, elo)
);

-- Extrato de pontos, igual ao extrato de dinheiro.
CREATE TABLE IF NOT EXISTS pontos_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  delta      INTEGER NOT NULL,
  saldo      INTEGER NOT NULL,
  motivo     TEXT,
  ref        TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pontos_user ON pontos_log(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS loja_itens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  nome       TEXT NOT NULL,
  descricao  TEXT,
  preco      INTEGER NOT NULL,          -- em pontos
  estoque    INTEGER NOT NULL DEFAULT -1, -- -1 = ilimitado
  vendidos   INTEGER NOT NULL DEFAULT 0,
  imagem     TEXT,
  ativo      INTEGER NOT NULL DEFAULT 1,
  criado_por TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS loja_pedidos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  item_id    INTEGER NOT NULL,
  item_nome  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  preco      INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'PENDENTE', -- PENDENTE | ENTREGUE | CANCELADO
  thread_id  TEXT,
  staff_id   TEXT,
  observacao TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pedido_status ON loja_pedidos(guild_id, status);

-- Denuncias de quebra de regra feitas dentro do ticket.
CREATE TABLE IF NOT EXISTS denuncias (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id   INTEGER NOT NULL,
  autor      TEXT NOT NULL,   -- quem se diz lesado
  acusado    TEXT NOT NULL,
  texto      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_denuncia_match ON denuncias(match_id);

-- Sugestoes publicadas pela comunidade e votos persistentes.
CREATE TABLE IF NOT EXISTS suggestions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  channel_id      TEXT NOT NULL,
  message_id      TEXT,
  thread_id       TEXT,
  author_id       TEXT NOT NULL,
  content         TEXT NOT NULL,
  attachment_urls TEXT,
  status          TEXT NOT NULL DEFAULT 'ABERTA', -- ABERTA | FECHADA
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suggestion_message ON suggestions(message_id);

CREATE TABLE IF NOT EXISTS suggestion_votes (
  suggestion_id INTEGER NOT NULL,
  user_id       TEXT NOT NULL,
  vote          TEXT NOT NULL, -- SIM | NAO
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (suggestion_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_suggestion_vote ON suggestion_votes(suggestion_id, vote);

-- Ultima resposta da IA por usuario. Permite conversa curta sem misturar jogadores.
CREATE TABLE IF NOT EXISTS ai_conversations (
  guild_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  response_id     TEXT NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- ============================ WIN STREAK ============================
-- streak_atual/streak_recorde ja migram como coluna em users (ver database.js)

-- ============================ COMPLETAR APOSTA ============================
-- Um jogador (lider) divide a stake dele com outro (completador).
CREATE TABLE IF NOT EXISTS completas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id     INTEGER NOT NULL,
  lado         TEXT NOT NULL,       -- 'p1' ou 'p2': qual participante foi completado
  lider        TEXT NOT NULL,
  completador  TEXT NOT NULL,
  valor_lider  INTEGER NOT NULL,    -- quanto do valor total ficou com o lider
  valor_completador INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'PENDENTE', -- PENDENTE | ACEITO | RECUSADO | CANCELADO
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_completa_match ON completas(match_id);

-- ============================ CAIXAS / ROLETA ============================
CREATE TABLE IF NOT EXISTS caixas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  nome        TEXT NOT NULL,
  descricao   TEXT,
  preco       INTEGER NOT NULL,     -- em pontos
  imagem_url  TEXT,
  ativo       INTEGER NOT NULL DEFAULT 1,
  criado_por  TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS caixa_premios (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  caixa_id   INTEGER NOT NULL,
  nome       TEXT NOT NULL,
  peso       INTEGER NOT NULL,      -- peso relativo no sorteio (nao precisa somar 100)
  cor        INTEGER,               -- cor de destaque quando esse premio sai
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_caixa_premio ON caixa_premios(caixa_id);

CREATE TABLE IF NOT EXISTS caixa_aberturas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  caixa_id   INTEGER NOT NULL,
  premio_id  INTEGER NOT NULL,
  user_id    TEXT NOT NULL,
  guild_id   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_abertura_user ON caixa_aberturas(user_id);

-- ============================ EVENTOS ============================
CREATE TABLE IF NOT EXISTS eventos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT NOT NULL,
  nome           TEXT NOT NULL,
  tipo           TEXT NOT NULL,        -- VITORIAS | DERROTAS
  meta           INTEGER NOT NULL,     -- quantidade necessaria
  premio_pontos  INTEGER NOT NULL DEFAULT 0,
  premio_texto   TEXT,
  permite_wo     INTEGER NOT NULL DEFAULT 1,
  permite_revanche INTEGER NOT NULL DEFAULT 1,
  exige_consecutivo INTEGER NOT NULL DEFAULT 0,
  inicio         INTEGER NOT NULL,
  fim            INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'ATIVO', -- ATIVO | ENCERRADO
  criado_por     TEXT,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS evento_progresso (
  evento_id  INTEGER NOT NULL,
  user_id    TEXT NOT NULL,
  progresso  INTEGER NOT NULL DEFAULT 0,
  concluido  INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (evento_id, user_id)
);

-- ============================ STREAMERS ============================
CREATE TABLE IF NOT EXISTS streamers (
  user_id     TEXT NOT NULL,
  guild_id    TEXT NOT NULL,
  modo        TEXT NOT NULL DEFAULT 'BASICO', -- BASICO | AVANCADO
  canal_id    TEXT,
  mensagem_id TEXT,
  ativo       INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, guild_id)
);

-- ============================ B.O / ANALISE DE TELA ============================
CREATE TABLE IF NOT EXISTS analises (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id     INTEGER NOT NULL,
  guild_id     TEXT NOT NULL,
  analista_id  TEXT,
  status       TEXT NOT NULL DEFAULT 'FILA', -- FILA | EM_ANDAMENTO | CONCLUIDA | WO
  iniciada_em  INTEGER,
  concluida_em INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analise_match ON analises(match_id);
CREATE INDEX IF NOT EXISTS idx_analise_status ON analises(guild_id, status);

-- ============================ TRANSCRIPT / TERMOS ============================
CREATE TABLE IF NOT EXISTS termos_aceites (
  user_id    TEXT NOT NULL,
  guild_id   TEXT NOT NULL,
  versao     TEXT NOT NULL,
  contexto   TEXT NOT NULL,   -- DEPOSITO | PARTIDA | SAQUE
  ref        TEXT,
  ip_hash    TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_termos_user ON termos_aceites(user_id, guild_id);

CREATE TABLE IF NOT EXISTS transcripts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  tipo        TEXT NOT NULL,       -- MATCH | DEPOSITO
  ref_id      TEXT NOT NULL,       -- match id ou deposit id
  thread_id   TEXT,
  conteudo    TEXT NOT NULL,       -- JSON com as mensagens capturadas
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transcript_ref ON transcripts(tipo, ref_id);
