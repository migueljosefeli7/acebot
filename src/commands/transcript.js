const { SlashCommandBuilder } = require('discord.js');
const cfg = require('../config');
const ui = require('../lib/ui');
const gc = require('../lib/guildconfig');
const transcript = require('../lib/transcript');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('transcript')
    .setDescription('[STAFF] Baixa o transcript (TXT/HTML) de uma partida ou depósito')
    .addStringOption((o) => o.setName('tipo').setDescription('Tipo de referência').setRequired(true)
      .addChoices({ name: 'Partida', value: 'MATCH' }, { name: 'Depósito', value: 'DEPOSITO' }))
    .addStringOption((o) => o.setName('id').setDescription('ID da partida ou do depósito').setRequired(true)),

  async execute(interaction) {
    if (!gc.hasRole(interaction.member, 'cargo_staff')) {
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.erro,
        ui.titulo('❌ Sem permissão'),
        ui.txt('Só a staff pode baixar transcripts.'),
      ), { efemero: true }));
    }

    const tipo = interaction.options.getString('tipo');
    const refId = interaction.options.getString('id');
    const t = transcript.ultimoPorRef(tipo, refId);

    if (!t) {
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.erro,
        ui.titulo('❌ Transcript não encontrado'),
        ui.txt(`Nenhum transcript capturado para ${tipo === 'MATCH' ? 'partida' : 'depósito'} #${refId}.`),
        ui.nota('O transcript só é gerado quando a partida/depósito é finalizado.'),
      ), { efemero: true }));
    }

    await interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
      ui.titulo('📄 TRANSCRIPT GERADO'),
      ui.txt(`${tipo === 'MATCH' ? 'Partida' : 'Depósito'} #${refId} · TXT e HTML em anexo.`),
    ), { efemero: true, files: transcript.anexos(t) }));
  },
};
