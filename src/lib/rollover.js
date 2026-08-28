const db = require('../db/database');
const cfg = require('../config');
const ui = require('./ui');
const money = require('./money');

/**
 * Rollover (PLD/FT) — exigencia anti-lavagem.
 *
 * Sem isso, alguem deposita R$100, nao joga nada e saca R$100: o bot vira
 * lavanderia. E um voucher de bonus viraria dinheiro sacavel de graca.
 *
 * A conta e sempre feita a partir do ULTIMO SAQUE PAGO. Tudo e derivado das
 * tabelas de origem (deposits / vouchers / matches) em vez de contadores
 * paralelos — contador desincroniza, fonte da verdade nao.
 *
 * Sao tres exigencias simultaneas:
 *   1. girar X% do que entrou (deposito + bonus) em partidas validas;
 *   2. um numero minimo de partidas validas;
 *   3. um numero minimo de ADVERSARIOS distintos (impede dois combinados
 *      ficarem passando o mesmo dinheiro de um para o outro).
 */

/** Momento do ultimo saque pago. Tudo antes disso ja foi quitado. */
const ultimoSaque = (userId) => db.prepare(
  "SELECT COALESCE(MAX(resolved_at), 0) t FROM withdrawals WHERE user_id = ? AND status = 'PAGO'"
).get(userId).t;

/** Entradas (deposito + bonus) desde o ultimo saque, uma a uma. */
function entradas(userId, desde) {
  const depositos = db.prepare(
    `SELECT id, amount, paid_at AS quando, 'DEPOSITO' AS origem
     FROM deposits WHERE user_id = ? AND status = 'PAGO' AND paid_at > ?`
  ).all(userId, desde);

  const bonus = db.prepare(
    `SELECT vu.code AS id, vu.amount, vu.used_at AS quando, 'BONUS' AS origem
     FROM voucher_uses vu WHERE vu.user_id = ? AND vu.used_at > ?`
  ).all(userId, desde);

  return [...depositos, ...bonus].sort((a, b) => a.quando - b.quando);
}

/** Partidas finalizadas em que o jogador entrou desde o ultimo saque. */
const partidasValidas = (userId, desde) => db.prepare(
  `SELECT id, p1, p2, valor, finished_at FROM matches
   WHERE (p1 = ? OR p2 = ?) AND status = 'FINALIZADA' AND finished_at > ?
   ORDER BY finished_at ASC`
).all(userId, userId, desde);

/**
 * Situacao completa do rollover do jogador.
 * `liberado: true` significa que ele pode sacar.
 */
function situacao(userId) {
  const desde = ultimoSaque(userId);
  const listaEntradas = entradas(userId, desde);
  const partidas = partidasValidas(userId, desde);

  const totalEntrou = listaEntradas.reduce((s, e) => s + e.amount, 0);
  const exigido = Math.ceil((totalEntrou * cfg.rolloverPercentual) / 100);
  const rodado = partidas.reduce((s, m) => s + m.valor, 0);

  const adversarios = new Set(partidas.map((m) => (m.p1 === userId ? m.p2 : m.p1)));

  const faltaValor = Math.max(0, exigido - rodado);
  const faltaApostas = Math.max(0, cfg.rolloverMinApostas - partidas.length);
  const faltaAdversarios = Math.max(0, cfg.rolloverMinAdversarios - adversarios.size);

  // Sem entrada nenhuma desde o ultimo saque nao ha o que exigir: o dinheiro
  // que sobrou ja cumpriu rollover no ciclo anterior.
  const liberado = totalEntrou === 0
    || (faltaValor === 0 && faltaApostas === 0 && faltaAdversarios === 0);

  // Distribuicao FIFO so para MOSTRAR o progresso por entrada, igual ao painel
  // que o jogador espera ver. A decisao acima usa os totais.
  let restante = rodado;
  const detalhe = listaEntradas.map((e) => {
    const obrigatorio = Math.ceil((e.amount * cfg.rolloverPercentual) / 100);
    const cobriu = Math.min(restante, obrigatorio);
    restante -= cobriu;
    return { ...e, obrigatorio, rodado: cobriu, falta: obrigatorio - cobriu };
  });

  return {
    liberado,
    desde,
    totalEntrou,
    exigido,
    rodado: Math.min(rodado, exigido),
    faltaValor,
    apostas: partidas.length,
    minApostas: cfg.rolloverMinApostas,
    faltaApostas,
    adversarios: adversarios.size,
    minAdversarios: cfg.rolloverMinAdversarios,
    faltaAdversarios,
    percentual: exigido > 0 ? Math.min(100, Math.floor((rodado / exigido) * 100)) : 100,
    detalhe,
  };
}

const barra = (pct, tamanho = 20) => {
  const cheio = Math.round((pct / 100) * tamanho);
  return '█'.repeat(cheio) + '░'.repeat(tamanho - cheio);
};

/** Painel que o jogador ve quando tenta sacar sem ter cumprido o rollover. */
function painel(userId) {
  const s = situacao(userId);

  const pendentes = s.detalhe.filter((e) => e.falta > 0).slice(0, 5);
  const linhasPendentes = pendentes.map((e, i) =>
    `**${i + 1}.** ${e.origem === 'BONUS' ? 'Bônus' : 'Depósito'} \`${String(e.id).slice(0, 8)}\`\n` +
    `└ Obrigatório: ${money.fmt(e.obrigatorio)} · Rodado: ${money.fmt(e.rodado)} · ` +
    `**Falta: ${money.fmt(e.falta)}**`
  );

  return ui.bloco(s.liberado ? cfg.COR.sucesso : cfg.COR.aviso,
    ui.titulo(s.liberado ? '🔓 ROLLOVER CUMPRIDO' : '🔒 ROLLOVER EM ANDAMENTO'),
    ui.nota(`Para sacar, você precisa girar ${cfg.rolloverPercentual}% do que entrou desde o último saque em partidas válidas`),
    ui.divisor(),
    ui.secao('Progresso'),
    ui.txt(`\`${barra(s.percentual)}\` **${s.percentual}%**`),
    ui.txt(
      `Cumprido: **${money.fmt(s.rodado)}** · Total exigido: **${money.fmt(s.exigido)}** · ` +
      `Restante: **${money.fmt(s.faltaValor)}**`
    ),
    ui.divisor(),
    ui.secao('O que falta'),
    ui.txt(
      `${s.faltaValor > 0 ? '❌' : '✅'} Girar **${money.fmt(s.faltaValor)}** (de ${money.fmt(s.exigido)})\n` +
      `${s.faltaApostas > 0 ? '❌' : '✅'} Apostas válidas: **${s.apostas}/${s.minApostas}**\n` +
      `${s.faltaAdversarios > 0 ? '❌' : '✅'} Adversários distintos: **${s.adversarios}/${s.minAdversarios}**`
    ),
    pendentes.length ? ui.divisor() : null,
    pendentes.length ? ui.secao('Depósitos/Eventos pendentes') : null,
    pendentes.length ? ui.txt(linhasPendentes.join('\n')) : null,
    ui.divisor(),
    ui.nota(
      'Rollover (PLD/FT): exige girar parte do depósito em partidas válidas antes do saque — medida anti-lavagem'
    ),
  );
}

module.exports = { situacao, painel, ultimoSaque, entradas, partidasValidas, barra };
