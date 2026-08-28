const { SlashCommandBuilder } = require('discord.js');
const cfg = require('../config');
const ui = require('../lib/ui');
const gc = require('../lib/guildconfig');
const streamers = require('../features/streamers');
const filaStreamer = require('../features/filaStreamer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('streamer')
    .setDescription('[STAFF] Gerencia o cadastro de streamers do servidor')

    .addSubcommand((s) => s.setName('registrar').setDescription('Cadastra um streamer (o painel dele é 100% por botão a partir daqui)')
      .addUserOption((o) => o.setName('usuario').setDescription('Quem vai virar streamer').setRequired(true))
      .addStringOption((o) => o.setName('modo').setDescription('Modo do painel')
        .addChoices({ name: 'Básico', value: 'BASICO' }, { name: 'Avançado', value: 'AVANCADO' })))

    .addSubcommand((s) => s.setName('remover').setDescription('Remove o cadastro de um streamer')
      .addUserOption((o) => o.setName('usuario').setDescription('Quem vai ser removido').setRequired(true))),

  async execute(interaction) {
    if (!gc.hasRole(interaction.member, 'cargo_staff')) {
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.erro,
        ui.titulo('❌ Sem permissão'),
        ui.txt('Só a staff gerencia cadastros de streamer.'),
      ), { efemero: true }));
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'registrar') {
      const usuario = interaction.options.getUser('usuario');
      const modo = interaction.options.getString('modo') || 'BASICO';
      streamers.registrar(interaction.guildId, usuario.id, { modo });
      await streamers.publicarPainel(interaction.client, interaction.guildId, usuario.id).catch(() => {});

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ STREAMER CADASTRADO'),
        ui.txt(`<@${usuario.id}> já tem o painel dele no canal de streamers — tudo (ficar ao vivo, abrir fila de desafio) é por botão.`),
        ui.nota('Canal configurado em /config canal canal_streamers.'),
      ), { efemero: true }));
    }

    if (sub === 'remover') {
      const usuario = interaction.options.getUser('usuario');
      streamers.remover(interaction.guildId, usuario.id);
      await filaStreamer.fechar(interaction.client, interaction.guildId, usuario.id).catch(() => {});
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.aviso,
        ui.titulo('🚫 STREAMER REMOVIDO'),
        ui.txt(`<@${usuario.id}> não é mais streamer cadastrado.`),
      ), { efemero: true }));
    }
  },
};
