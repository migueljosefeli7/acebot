const { SlashCommandBuilder, ChannelType } = require('discord.js');

const cfg = require('../config');
const ui = require('../lib/ui');
const gc = require('../lib/guildconfig');

const erro = (interaction, titulo, texto) => interaction.reply(ui.msg(
  ui.bloco(cfg.COR.erro, ui.titulo(`❌ ${titulo}`), ui.txt(texto)),
  { efemero: true },
));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sugestao')
    .setDescription('[STAFF] Configura o sistema de sugestões e votação')
    .addSubcommand((s) => s.setName('configurar').setDescription('Define o canal onde mensagens viram sugestões')
      .addChannelOption((o) => o.setName('canal').setDescription('Canal de sugestões')
        .setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('desativar').setDescription('Desativa a conversão automática de sugestões'))
    .addSubcommand((s) => s.setName('ver').setDescription('Mostra o canal configurado')),

  async execute(interaction) {
    if (!gc.hasRole(interaction.member, 'cargo_staff')) {
      return erro(interaction, 'Sem permissão', 'Só a staff pode configurar as sugestões.');
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'configurar') {
      const canal = interaction.options.getChannel('canal');
      if (canal.id === gc.get(interaction.guildId, 'canal_ia')) {
        return erro(interaction, 'Canal já usado pela IA', 'Escolha outro canal para não misturar sugestões com o IA Chat.');
      }
      gc.set(interaction.guildId, 'canal_sugestoes', canal.id);
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ CANAL DE SUGESTÕES CONFIGURADO'),
        ui.txt(
          `A partir de agora, toda mensagem comum enviada em ${canal} será transformada em votação.\n\n` +
          'O bot publicará os botões **SIM** e **NÃO** e abrirá um tópico para discussão.'
        ),
        ui.nota('O bot precisa poder gerenciar mensagens e criar tópicos públicos nesse canal.'),
      ), { efemero: true }));
    }

    if (sub === 'desativar') {
      gc.set(interaction.guildId, 'canal_sugestoes', '');
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.neutro,
        ui.titulo('⏸️ SUGESTÕES DESATIVADAS'),
        ui.txt('As mensagens não serão mais convertidas automaticamente.'),
      ), { efemero: true }));
    }

    const canalId = gc.get(interaction.guildId, 'canal_sugestoes');
    return interaction.reply(ui.msg(ui.bloco(canalId ? cfg.COR.sucesso : cfg.COR.aviso,
      ui.titulo('💡 SISTEMA DE SUGESTÕES'),
      ui.txt(canalId ? `Canal configurado: <#${canalId}>` : 'Nenhum canal está configurado.'),
    ), { efemero: true }));
  },
};
