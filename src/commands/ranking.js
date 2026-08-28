const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const cfg = require('../config');
const ui = require('../lib/ui');
const gc = require('../lib/guildconfig');
const ranking = require('../features/ranking');
const elo = require('../features/elo');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Ranking de pontos do servidor')

    .addSubcommand((s) => s.setName('ver').setDescription('Mostra o top 10 agora'))

    .addSubcommand((s) => s.setName('periodo').setDescription('Mostra o ranking de vitórias por período')
      .addStringOption((o) => o.setName('quando').setDescription('Janela de tempo').setRequired(true)
        .addChoices(
          { name: 'Diário (últimas 24h)', value: 'diario' },
          { name: 'Semanal (últimos 7 dias)', value: 'semanal' },
          { name: 'Mensal (últimos 30 dias)', value: 'mensal' },
        )))

    .addSubcommand((s) => s.setName('painel')
      .setDescription('[ADMIN] Publica o ranking fixo em um canal (atualiza sozinho)')
      .addChannelOption((o) => o.setName('canal').setDescription('Canal do ranking (padrão: o atual)')
        .addChannelTypes(ChannelType.GuildText)))

    .addSubcommand((s) => s.setName('atualizar')
      .setDescription('[ADMIN] Recalcula os cargos de pódio e reescreve o painel')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const admin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

    if (sub === 'ver') {
      return interaction.reply(ui.msg(ranking.painel(interaction.guildId), { efemero: true }));
    }

    if (sub === 'periodo') {
      const quando = interaction.options.getString('quando');
      return interaction.reply(ui.msg(ranking.painelPeriodo(interaction.guildId, quando), { efemero: true }));
    }

    if (!admin) {
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.erro,
        ui.titulo('❌ Sem permissão'),
        ui.txt('Só administradores publicam ou recalculam o ranking.'),
      ), { efemero: true }));
    }

    if (sub === 'painel') {
      const canal = interaction.options.getChannel('canal') || interaction.channel;
      gc.set(interaction.guildId, 'canal_ranking', canal.id);

      const msg = await canal.send(ui.msg(ranking.painel(interaction.guildId)));
      gc.set(interaction.guildId, 'mensagem_ranking', msg.id);

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ RANKING PUBLICADO'),
        ui.txt(`O top 10 está em ${canal} e se atualiza a cada partida.`),
        ui.nota('Configure os cargos de pódio com /config cargo cargo_top1, top2 e top3.'),
      ), { efemero: true }));
    }

    if (sub === 'atualizar') {
      await interaction.deferReply({ flags: ui.EFEMERO });
      const r = await ranking.sincronizarCargosTopo(interaction.guildId ? interaction.client : null, interaction.guildId);
      await ranking.atualizarPainel(interaction.client, interaction.guildId);

      const podio = ranking.top(3);
      return interaction.editReply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('🔄 RANKING ATUALIZADO'),
        ui.divisor(),
        ui.txt(podio.length
          ? podio.map((u, i) => {
              const e = elo.eloDe(u.pontos);
              return `${ranking.MEDALHAS[i]} <@${u.discord_id}> — ${e.emoji} ${e.nome} · \`${u.pontos} pts\``;
            }).join('\n')
          : '_Ninguém pontuou ainda._'),
        r.ok === false ? ui.nota(`Cargos de pódio não aplicados: ${r.motivo}`) : null,
      )));
    }
  },
};
