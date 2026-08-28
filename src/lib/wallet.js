const db = require('../db/database');

const now = () => Date.now();

/**
 * Carteira do jogador. Tudo em CENTAVOS inteiros.
 *
 * Sao DOIS bolsos:
 *  - `balance`     saldo REAL. Veio de deposito ou de premio ganho em partida.
 *                  Esse e o unico que pode ser sacado.
 *  - `saldo_bonus` saldo de BONUS. Veio de voucher/promocao. Da para jogar,
 *                  NAO da para sacar. Vira real so quando o jogador ganha
 *                  uma partida (o premio inteiro cai em `balance`).
 *
 * `locked` e o total reservado (fila, partida, saque pendente) e
 * `locked_bonus` diz quanto desse total saiu do bolso de bonus — sem isso o
 * bonus viraria dinheiro sacavel na primeira devolucao.
 */

function ensureUser(userId) {
  db.prepare('INSERT OR IGNORE INTO users (discord_id, created_at) VALUES (?, ?)').run(userId, now());
  return db.prepare('SELECT * FROM users WHERE discord_id = ?').get(userId);
}

const getUser = (userId) => ensureUser(userId);

/** Saldo REAL (sacavel). */
const getBalance = (userId) => ensureUser(userId).balance;

/** Saldo de bonus (so joga). */
const getBonus = (userId) => ensureUser(userId).saldo_bonus;

/** Quanto o jogador tem para APOSTAR: real + bonus. */
const getJogavel = (userId) => {
  const u = ensureUser(userId);
  return u.balance + u.saldo_bonus;
};

const getSaldos = (userId) => {
  const u = ensureUser(userId);
  return {
    real: u.balance,
    bonus: u.saldo_bonus,
    jogavel: u.balance + u.saldo_bonus,
    reservado: u.locked,
    reservadoBonus: u.locked_bonus,
  };
};

function logTx(userId, type, amount, balanceAfter, description, ref) {
  db.prepare(
    `INSERT INTO transactions (user_id, type, amount, balance_after, description, ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, type, amount, balanceAfter, description || null, ref ? String(ref) : null, now());
}

/** Credita saldo REAL (sacavel). */
const credit = db.transaction((userId, amount, type, description, ref) => {
  if (amount <= 0) throw new Error('Valor de credito invalido');
  ensureUser(userId);
  db.prepare('UPDATE users SET balance = balance + ?, total_in = total_in + ? WHERE discord_id = ?')
    .run(amount, type === 'DEPOSITO' ? amount : 0, userId);
  const bal = getBalance(userId);
  logTx(userId, type, amount, bal, description, ref);
  return bal;
});

/** Credita saldo de BONUS (voucher/promocao). Nao entra em total_in: nao e dinheiro que entrou. */
const creditBonus = db.transaction((userId, amount, type, description, ref) => {
  if (amount <= 0) throw new Error('Valor de credito invalido');
  ensureUser(userId);
  db.prepare('UPDATE users SET saldo_bonus = saldo_bonus + ? WHERE discord_id = ?').run(amount, userId);
  const u = ensureUser(userId);
  logTx(userId, type, amount, u.balance, `${description || ''} (bônus)`.trim(), ref);
  return u.saldo_bonus;
});

/** Debita saldo REAL. Lanca se nao tiver. */
const debit = db.transaction((userId, amount, type, description, ref) => {
  if (amount <= 0) throw new Error('Valor de debito invalido');
  ensureUser(userId);
  const info = db.prepare('UPDATE users SET balance = balance - ? WHERE discord_id = ? AND balance >= ?')
    .run(amount, userId, amount);
  if (info.changes === 0) throw new Error('SALDO_INSUFICIENTE');
  const bal = getBalance(userId);
  logTx(userId, type, -amount, bal, description, ref);
  return bal;
});

/**
 * Reserva valor para fila/partida/saque.
 *
 * `usarBonus: true`  (padrao, partidas) — gasta o BONUS primeiro.
 * `usarBonus: false` (saques)           — so encosta no saldo real.
 */
const lock = db.transaction((userId, amount, { usarBonus = true } = {}) => {
  if (amount <= 0) throw new Error('Valor de trava invalido');
  const u = ensureUser(userId);

  const doBonus = usarBonus ? Math.min(u.saldo_bonus, amount) : 0;
  const doReal = amount - doBonus;

  if (u.balance < doReal) throw new Error('SALDO_INSUFICIENTE');

  db.prepare(
    `UPDATE users SET
       saldo_bonus  = saldo_bonus - ?,
       balance      = balance - ?,
       locked       = locked + ?,
       locked_bonus = locked_bonus + ?
     WHERE discord_id = ? AND saldo_bonus >= ? AND balance >= ?`
  ).run(doBonus, doReal, amount, doBonus, userId, doBonus, doReal);

  return { doBonus, doReal };
});

/**
 * Devolve valor reservado.
 * Devolve para o BONUS primeiro (ate zerar `locked_bonus`) para o jogador nao
 * receber de volta como dinheiro sacavel algo que entrou como bonus.
 */
const unlock = db.transaction((userId, amount, { usarBonus = true } = {}) => {
  const u = ensureUser(userId);
  if (u.locked < amount) throw new Error('TRAVA_INVALIDA');

  const paraBonus = usarBonus ? Math.min(u.locked_bonus, amount) : 0;
  const paraReal = amount - paraBonus;

  db.prepare(
    `UPDATE users SET
       saldo_bonus  = saldo_bonus + ?,
       balance      = balance + ?,
       locked       = locked - ?,
       locked_bonus = locked_bonus - ?
     WHERE discord_id = ? AND locked >= ?`
  ).run(paraBonus, paraReal, amount, paraBonus, userId, amount);

  return { paraBonus, paraReal };
});

/** Consome o reservado de vez (perdeu a partida / saque pago). Queima o bonus primeiro. */
const consumeLocked = db.transaction((userId, amount, type, description, ref, { usarBonus = true } = {}) => {
  const u = ensureUser(userId);
  if (u.locked < amount) throw new Error('TRAVA_INVALIDA');

  const doBonus = usarBonus ? Math.min(u.locked_bonus, amount) : 0;

  db.prepare(
    `UPDATE users SET
       locked       = locked - ?,
       locked_bonus = locked_bonus - ?,
       total_out    = total_out + ?
     WHERE discord_id = ? AND locked >= ?`
  ).run(amount, doBonus, type === 'SAQUE' ? amount : 0, userId, amount);

  logTx(userId, type, -amount, getBalance(userId), description, ref);
  return { doBonus, doReal: amount - doBonus };
});

const extrato = (userId, limit = 10) =>
  db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit);

module.exports = {
  ensureUser, getUser, getBalance, getBonus, getJogavel, getSaldos,
  credit, creditBonus, debit, lock, unlock, consumeLocked, extrato, logTx,
};
