const crypto = require('node:crypto');
const {
  ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');

const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const money = require('../lib/money');
const wallet = require('../lib/wallet');
const logs = require('../lib/logs');

// Sem I, O, 0 e 1 para ninguem errar na hora de digitar.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function gerarCodigo(prefixo = 'GUETO') {
  const bloco = (n) => Array.from(crypto.randomBytes(n))
    .map((b) => ALFABETO[b % ALFABETO.length]).join('');
  return `${prefixo}-${bloco(4)}-${bloco(4)}`.toUpperCase();
}

const normalizar = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '');
const get = (code) => db.prepare('SELECT * FROM vouchers WHERE code = ?').get(normalizar(code));

const MOTIVOS = {
  NAO_EXISTE: 'Esse código não existe. Confira se digitou certo.',
  INATIVO: 'Esse voucher foi desativado pela staff.',
  EXPIRADO: 'Esse voucher já expirou.',
  ESGOTADO: 'Esse voucher já atingiu o limite de usos.',
  JA_USADO: 'Você já resgatou esse voucher.',
  NAO_E_SEU: 'Esse voucher é exclusivo de outro jogador.',
};

/**
 * Resgata um voucher e credita o saldo.
 * Tudo numa transacao: a PK de voucher_uses impede resgate duplo mesmo em cliques simultaneos.
 */
const resgatar = db.transaction((code, userId) => {
  const v = get(code);
  if (!v) return { erro: 'NAO_EXISTE' };
  if (!v.ativo) return { erro: 'INATIVO' };
  if (v.expires_at && v.expires_at < Date.now()) return { erro: 'EXPIRADO' };
  if (v.uses >= v.max_uses) return { erro: 'ESGOTADO' };
  if (v.restrito_a && v.restrito_a !== userId) return { erro: 'NAO_E_SEU' };

  const jaUsou = db.prepare('SELECT 1 FROM voucher_uses WHERE code = ? AND user_id = ?').get(v.code, userId);
  if (jaUsou) return { erro: 'JA_USADO' };

  // O WHERE uses < max_uses fecha a corrida por ultimo uso.
  const info = db.prepare('UPDATE vouchers SET uses = uses + 1 WHERE code = ? AND uses < max_uses')
    .run(v.code);
  if (info.changes === 0) return { erro: 'ESGOTADO' };

  db.prepare('INSERT INTO voucher_uses (code, user_id, amount, used_at) VALUES (?, ?, ?, ?)')
    .run(v.code, userId, v.amount, Date.now());

  // Voucher entra como BONUS: da para jogar, nao da para sacar direto.
  const saldo = wallet.creditBonus(userId, v.amount, 'VOUCHER',
    `Voucher ${v.code}${v.descricao ? ' — ' + v.descricao : ''}`, `voucher:${v.code}`);

  return { ok: true, voucher: v, saldo };
});

/* -------------------------------------------------------------------- UI */

const modalResgate = () =>
  new ModalBuilder().setCustomId('wallet:voucher_modal').setTitle('Resgatar voucher')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('codigo').setLabel('Código do voucher')
        .setPlaceholder('Ex: GUETO-A7K2-9XPM')
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40)));

async function processarResgate(interaction) {
  const code = normalizar(interaction.fields.getTextInputValue('codigo'));
  const r = resgatar(code, interaction.user.id);

  if (r.erro) {
    return interaction.reply(ui.msg(ui.bloco(cfg.COR.erro,
      ui.titulo('❌ VOUCHER INVÁLIDO'),
      ui.txt(`Código: \`${code}\``),
      ui.divisor(),
      ui.txt(MOTIVOS[r.erro] || 'Não foi possível resgatar.'),
    ), { efemero: true }));
  }

  await interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
    ui.titulo('🎟️ VOUCHER RESGATADO!'),
    ui.nota(`Código \`${r.voucher.code}\``),
    ui.divisor(),
    ui.tabela([
      ['Valor creditado', money.fmt(r.voucher.amount)],
      ['Saldo atual', money.fmt(r.saldo)],
    ]),
    r.voucher.descricao ? ui.txt(`_${r.voucher.descricao}_`) : null,
  ), { efemero: true }));

  await logs.voucher(interaction.client, interaction.guildId, {
    userId: interaction.user.id, code: r.voucher.code, amount: r.voucher.amount,
    saldo: r.saldo, usos: r.voucher.uses + 1, max: r.voucher.max_uses, criadoPor: r.voucher.criado_por,
  });
}

/* --------------------------------------------------------------- PAINEIS */

const estadoDe = (v) => !v.ativo ? '⚪ Desativado'
  : v.expires_at && v.expires_at < Date.now() ? '⏰ Expirado'
  : v.uses >= v.max_uses ? '🔴 Esgotado'
  : '🟢 Ativo';

function painelVoucher(v) {
  return ui.bloco(cfg.COR.primaria,
    ui.titulo(`🎟️ ${v.code}`),
    ui.nota(`${estadoDe(v)} · criado por <@${v.criado_por}>`),
    ui.divisor(),
    ui.tabela([
      ['Valor por resgate', money.fmt(v.amount)],
      ['Usos', `${v.uses}/${v.max_uses}`],
      ['Custo se usarem tudo', money.fmt(v.amount * v.max_uses)],
      ['Ja gasto', money.fmt(v.amount * v.uses)],
    ]),
    ui.txt(
      `**Exclusivo de:** ${v.restrito_a ? `<@${v.restrito_a}>` : 'qualquer jogador'}\n` +
      `**Validade:** ${v.expires_at ? `<t:${Math.floor(v.expires_at / 1000)}:R>` : 'sem prazo'}`
    ),
    v.descricao ? ui.txt(`**Descrição:** ${v.descricao}`) : null,
  );
}

const listar = (guildId, apenasAtivos) => db.prepare(
  `SELECT * FROM vouchers WHERE guild_id = ?${apenasAtivos ? ' AND ativo = 1 AND uses < max_uses' : ''}
   ORDER BY created_at DESC LIMIT 25`
).all(guildId);

const usos = (code) =>
  db.prepare('SELECT * FROM voucher_uses WHERE code = ? ORDER BY used_at DESC LIMIT 20').all(normalizar(code));

module.exports = {
  gerarCodigo, normalizar, get, resgatar, modalResgate, processarResgate,
  painelVoucher, estadoDe, listar, usos, MOTIVOS,
};
