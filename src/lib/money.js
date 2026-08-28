// Todo dinheiro no bot circula em CENTAVOS (inteiro). Float em dinheiro = bug garantido.

const fmt = (cents) =>
  'R$ ' + (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Aceita "100", "100,50", "R$ 100.50", "1.234,56"
function parse(input) {
  if (typeof input === 'number') return Math.round(input * 100);
  let s = String(input).trim().replace(/r\$/i, '').replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const toReais = (cents) => Number((cents / 100).toFixed(2));

module.exports = { fmt, parse, toReais };
