const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

// DB_FILE aponta para outro banco. Usado nos testes, para nunca encostar no
// banco de producao que guarda o saldo dos jogadores.
const dbPath = process.env.DB_FILE || path.join(__dirname, '..', '..', 'data', 'ace.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

/**
 * Colunas adicionadas depois que o banco ja existia.
 * CREATE TABLE IF NOT EXISTS nao altera tabela criada antes, entao cada coluna
 * nova precisa entrar aqui para os bancos em producao acompanharem.
 */
const COLUNAS_NOVAS = [
  ['matches', 'pago_p1', 'INTEGER NOT NULL DEFAULT 0'],
  ['matches', 'pago_p2', 'INTEGER NOT NULL DEFAULT 0'],
  ['deposits', 'match_id', 'INTEGER'],
  ['deposits', 'finalidade', "TEXT NOT NULL DEFAULT 'SALDO'"],
  ['queue_entries', 'pago', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'pontos', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'pontos_pico', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'elo', 'TEXT'],
  ['matches', 'ss_nicks', 'TEXT'],
  ['matches', 'recriacoes', 'INTEGER NOT NULL DEFAULT 0'],
  ['matches', 'recriar_p1', 'INTEGER NOT NULL DEFAULT 0'],
  ['matches', 'recriar_p2', 'INTEGER NOT NULL DEFAULT 0'],
  ['matches', 'painel_msg_id', 'TEXT'],
  ['users', 'saldo_bonus', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'locked_bonus', 'INTEGER NOT NULL DEFAULT 0'],
  ['matches', 'claim_em', 'INTEGER'],
  ['users', 'streak_atual', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'streak_recorde', 'INTEGER NOT NULL DEFAULT 0'],
  ['matches', 'evento_id', 'INTEGER'],
  ['deposits', 'thread_id', 'TEXT'],
  ['deposits', 'termos_aceitos', 'INTEGER NOT NULL DEFAULT 0'],
  ['streamers', 'ao_vivo', 'INTEGER NOT NULL DEFAULT 0'],
  ['streamers', 'link', 'TEXT'],
  ['streamers', 'titulo', 'TEXT'],
  ['analises', 'prazo_minutos', 'INTEGER'],
  ['queues', 'streamer_id', 'TEXT'],
  ['queues', 'thread_id', 'TEXT'],
  ['queues', 'gelo', 'TEXT'],
  ['queues', 'limite_partidas', 'INTEGER'],
  ['queues', 'partidas_jogadas', 'INTEGER NOT NULL DEFAULT 0'],
  ['queues', 'regras', 'TEXT'],
  ['matches', 'sala_pronta_em', 'INTEGER'],
  ['matches', 'go_p1', 'INTEGER NOT NULL DEFAULT 0'],
  ['matches', 'go_p2', 'INTEGER NOT NULL DEFAULT 0'],
  ['matches', 'go_msg_id', 'TEXT'],
  ['matches', 'em_andamento_em', 'INTEGER'],
  ['matches', 'pronto_pra_resultado', 'INTEGER NOT NULL DEFAULT 0'],
  ['matches', 'sala_status_msg_id', 'TEXT'],
  ['matches', 'sala_placar_msg_id', 'TEXT'],
];

for (const [tabela, coluna, tipo] of COLUNAS_NOVAS) {
  const existe = db.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === coluna);
  if (!existe) {
    db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
    console.log(`[db] coluna ${tabela}.${coluna} adicionada`);
  }
}

/**
 * Conserto das flags de pagamento.
 *
 * Antes da cobranca dentro do ticket existir, so entrava na fila quem tinha
 * saldo — ou seja, TODA partida antiga ja estava com o valor travado. As
 * colunas novas nasceram com 0 e marcaram essas partidas como nao pagas, o que
 * travava a finalizacao e prendia o jogador numa partida eterna.
 *
 * Qualquer partida que passou da fase de pagamento tem, por definicao, os dois
 * valores garantidos. AGUARDANDO_PAGAMENTO fica de fora: essa e a unica fase em
 * que 0 significa mesmo "nao pagou".
 */
const conserto = db.prepare(
  `UPDATE matches SET pago_p1 = 1, pago_p2 = 1
   WHERE status != 'AGUARDANDO_PAGAMENTO' AND (pago_p1 = 0 OR pago_p2 = 0)`
).run();
if (conserto.changes) {
  console.log(`[db] ${conserto.changes} partida(s) com flag de pagamento corrigida`);
}

module.exports = db;
