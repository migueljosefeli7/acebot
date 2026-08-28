const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const money = require('../lib/money');
const wallet = require('../lib/wallet');
const logs = require('../lib/logs');
const carteira = require('../features/carteira');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('saldo')
    .setDescription('[ADMIN] Gerencia o saldo dos jogadores')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    .addSubcommand((s) => s.setName('adicionar').setDescription('Adiciona saldo na conta de um jogador')
      .addUserOption((o) => o.setName('jogador').setDescription('Quem vai receber').setRequired(true))
      .addStringOption((o) => o.setName('valor').setDescription('Ex: 50 ou 50,00').setRequired(true))
      .addStringOption((o) => o.setName('motivo').setDescription('Aparece no log e no extrato')))

    .addSubcommand((s) => s.setName('remover').setDescription('Remove saldo da conta de um jogador')
      .addUserOption((o) => o.setName('jogador').setDescription('De quem').setRequired(true))
      .addStringOption((o) => o.setName('valor').setDescription('Ex: 50 ou 50,00').setRequired(true))
      .addStringOption((o) => o.setName('motivo').setDescription('Aparece no log e no extrato')))

    .addSubcommand((s) => s.setName('ver').setDescription('Consulta a carteira de um jogador')
      .addUserOption((o) => o.setName('jogador').setDescription('Quem').setRequired(true)))

    .addSubcommand((s) => s.setName('extrato').setDescription('Últimas movimentações de um jogador')
      .addUserOption((o) => o.setName('jogador').setDescription('Quem').setRequired(true)))

    .addSubcommand((s) => s.setName('bloquear').setDescription('Bloqueia/desbloqueia o jogador de entrar em filas')
      .addUserOption((o) => o.setName('jogador').setDescription('Quem').setRequired(true))
      .addBooleanOption((o) => o.setName('bloquear').setDescription('true = bloquear, false = liberar').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const alvo = interaction.options.getUser('jogador');
    wallet.ensureUser(alvo.id);

    if (sub === 'ver') {
      return interaction.reply(ui.msg(carteira.perfil(alvo), { efemero: true }));
    }
    if (sub === 'extrato') {
      return interaction.reply(ui.msg(carteira.extrato(alvo), { efemero: true }));
    }

    if (sub === 'bloquear') {
      const bloquear = interaction.options.getBoolean('bloquear');
      db.prepare('UPDATE users SET banned = ? WHERE discord_id = ?').run(bloquear ? 1 : 0, alvo.id);
      return interaction.reply(ui.msg(ui.bloco(bloquear ? cfg.COR.erro : cfg.COR.sucesso,
        ui.titulo(bloquear ? '🚫 JOGADOR BLOQUEADO' : '✅ JOGADOR LIBERADO'),
        ui.txt(`${alvo} ${bloquear ? '**não pode mais** entrar em filas.' : 'voltou a poder entrar em filas.'}`),
      ), { efemero: true }));
    }

    const valor = money.parse(interaction.options.getString('valor'));
    const motivo = interaction.options.getString('motivo') || 'Ajuste manual da administração';
    if (valor === null || valor <= 0) {
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.erro,
        ui.titulo('❌ Valor inválido'), ui.txt('Use `50` ou `50,00`.'),
      ), { efemero: true }));
    }

    if (sub === 'adicionar') {
      const saldo = wallet.credit(alvo.id, valor, 'ADMIN_ADD', motivo, `admin:${interaction.user.id}`);

      await interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ SALDO ADICIONADO'),
        ui.txt(`Jogador: ${alvo}`),
        ui.divisor(),
        ui.tabela([
          ['Valor adicionado', money.fmt(valor)],
          ['Saldo atual', money.fmt(saldo)],
        ]),
        ui.nota(motivo),
      ), { efemero: true }));

      await logs.admin(interaction.client, interaction.guildId, {
        staffId: interaction.user.id, userId: alvo.id, amount: valor,
        acao: 'Saldo adicionado pela administração', motivo,
      });

      try {
        await alvo.send(ui.msg(ui.bloco(cfg.COR.sucesso,
          ui.titulo('💰 SALDO ADICIONADO'),
          ui.divisor(),
          ui.tabela([
            ['Valor recebido', money.fmt(valor)],
            ['Saldo atual', money.fmt(saldo)],
          ]),
          ui.txt(`_${motivo}_`),
        )));
      } catch { /* DM fechada */ }
      return;
    }

    if (sub === 'remover') {
      let saldo;
      try {
        saldo = wallet.debit(alvo.id, valor, 'ADMIN_REMOVE', motivo, `admin:${interaction.user.id}`);
      } catch {
        return interaction.reply(ui.msg(ui.bloco(cfg.COR.erro,
          ui.titulo('❌ Saldo insuficiente'),
          ui.txt(`${alvo} tem só **${money.fmt(wallet.getBalance(alvo.id))}** disponível.\n` +
            'O saldo em jogo não pode ser removido.'),
        ), { efemero: true }));
      }

      await interaction.reply(ui.msg(ui.bloco(cfg.COR.erro,
        ui.titulo('✅ SALDO REMOVIDO'),
        ui.txt(`Jogador: ${alvo}`),
        ui.divisor(),
        ui.tabela([
          ['Valor removido', money.fmt(valor)],
          ['Saldo atual', money.fmt(saldo)],
        ]),
        ui.nota(motivo),
      ), { efemero: true }));

      await logs.admin(interaction.client, interaction.guildId, {
        staffId: interaction.user.id, userId: alvo.id, amount: -valor,
        acao: 'Saldo removido pela administração', motivo,
      });
    }
  },
};
