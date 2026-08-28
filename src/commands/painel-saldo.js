const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const cfg = require('../config');
const ui = require('../lib/ui');
const carteira = require('../features/carteira');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel-saldo')
    .setDescription('Publica o painel fixo da carteira em um canal')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((o) => o.setName('canal').setDescription('Canal do painel (padrão: o atual)')
      .addChannelTypes(ChannelType.GuildText)),

  async execute(interaction) {
    const canal = interaction.options.getChannel('canal') || interaction.channel;
    await canal.send(ui.msg(carteira.painel()));

    return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
      ui.titulo('✅ PAINEL PUBLICADO'),
      ui.txt(`A carteira está disponível em ${canal}.`),
    ), { efemero: true }));
  },
};
