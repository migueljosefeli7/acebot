const { SlashCommandBuilder } = require('discord.js');
const cfg = require('../config');
const ui = require('../lib/ui');
const gc = require('../lib/guildconfig');
const analises = require('../features/analises');

const erro = (interaction, titulo, texto) => interaction.reply(ui.msg(
  ui.bloco(cfg.COR.erro, ui.titulo(`❌ ${titulo}`), ui.txt(texto)), { efemero: true },
));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bo')
    .setDescription('[STAFF] Fila interna do VAR — controle de tempo e quantidade')

    .addSubcommand((s) => s.setName('fila').setDescription('Mostra a fila de análises aguardando'))
    .addSubcommand((s) => s.setName('minhas').setDescription('Mostra suas análises em andamento'))

    .addSubcommand((s) => s.setName('assumir').setDescription('Assume uma análise da fila')
      .addIntegerOption((o) => o.setName('id').setDescription('ID da análise (/bo fila)').setRequired(true)))

    .addSubcommand((s) => s.setName('concluir').setDescription('Marca uma análise como concluída')
      .addIntegerOption((o) => o.setName('id').setDescription('ID da análise').setRequired(true))),

  async execute(interaction) {
    if (!gc.hasRole(interaction.member, 'cargo_staff') &&
        !gc.hasRole(interaction.member, 'cargo_staff_ss') &&
        !gc.hasRole(interaction.member, 'cargo_analista')) {
      return erro(interaction, 'Sem permissão', 'Só a staff e os analistas do VAR acessam essa fila.');
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'fila') {
      return interaction.reply(ui.msg(analises.painelFila(interaction.guildId), { efemero: true }));
    }
    if (sub === 'minhas') {
      return interaction.reply(ui.msg(analises.painelMinhasAnalises(interaction.user.id), { efemero: true }));
    }

    if (sub === 'assumir') {
      const id = interaction.options.getInteger('id');
      const r = analises.assumir(id, interaction.user.id);

      if (r.erro === 'NAO_EXISTE') return erro(interaction, 'Análise não encontrada', `Não existe análise #${id}.`);
      if (r.erro === 'JA_ASSUMIDA') return erro(interaction, 'Já assumida', 'Essa análise já foi assumida ou concluída.');
      if (r.erro === 'LIMITE_ATINGIDO') {
        return erro(interaction, 'Limite de análises simultâneas',
          `Você já tem ${r.limite} análise(s) em andamento. Conclua uma antes de assumir outra.`);
      }

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ ANÁLISE ASSUMIDA'),
        ui.txt(`Análise #${id} (partida #${r.analise.match_id}) assumida.`),
        ui.nota(`Prazo: ${cfg.boTempoMaximoMinutos} minutos.`),
      ), { efemero: true }));
    }

    if (sub === 'concluir') {
      const id = interaction.options.getInteger('id');
      const a = analises.getAnalise(id);
      if (!a || a.guild_id !== interaction.guildId) {
        return erro(interaction, 'Análise não encontrada', `Não existe análise #${id}.`);
      }
      analises.concluir(id);
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ ANÁLISE CONCLUÍDA'),
        ui.txt(`Análise #${id} marcada como concluída.`),
      ), { efemero: true }));
    }
  },
};
