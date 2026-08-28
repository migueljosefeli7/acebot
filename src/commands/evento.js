const { SlashCommandBuilder, ChannelType } = require('discord.js');
const cfg = require('../config');
const ui = require('../lib/ui');
const gc = require('../lib/guildconfig');
const eventos = require('../features/eventos');
const partida = require('../features/partida');

const erro = (interaction, titulo, texto) => interaction.reply(ui.msg(
  ui.bloco(cfg.COR.erro, ui.titulo(`❌ ${titulo}`), ui.txt(texto)), { efemero: true },
));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('evento')
    .setDescription('[STAFF] Eventos personalizados (W.O., revanche, consecutividade)')

    .addSubcommand((s) => s.setName('painel')
      .setDescription('[STAFF] Publica o painel fixo de eventos em um canal (atualiza sozinho)')
      .addChannelOption((o) => o.setName('canal').setDescription('Canal (padrão: o atual)').addChannelTypes(ChannelType.GuildText)))

    .addSubcommand((s) => s.setName('criar').setDescription('[STAFF] Cria um evento personalizado')
      .addStringOption((o) => o.setName('nome').setDescription('Nome do evento').setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName('tipo').setDescription('O que conta para a meta').setRequired(true)
        .addChoices({ name: 'Vitórias', value: 'VITORIAS' }, { name: 'Derrotas', value: 'DERROTAS' }))
      .addIntegerOption((o) => o.setName('meta').setDescription('Quantidade necessária').setRequired(true).setMinValue(1))
      .addIntegerOption((o) => o.setName('premio_pontos').setDescription('Pontos de recompensa').setMinValue(0))
      .addStringOption((o) => o.setName('premio_texto').setDescription('Descrição de um prêmio extra (ex: item da loja)').setMaxLength(200))
      .addIntegerOption((o) => o.setName('duracao_dias').setDescription('Duração em dias (padrão 7)').setMinValue(1))
      .addBooleanOption((o) => o.setName('exige_consecutivo').setDescription('Perder zera o progresso? (padrão não)'))
      .addBooleanOption((o) => o.setName('permite_wo').setDescription('W.O. conta para a meta? (padrão sim)'))
      .addBooleanOption((o) => o.setName('permite_revanche').setDescription('Revanche conta para a meta? (padrão sim)')))

    .addSubcommand((s) => s.setName('encerrar').setDescription('[STAFF] Encerra um evento antes do prazo')
      .addIntegerOption((o) => o.setName('id').setDescription('ID do evento').setRequired(true)))

    .addSubcommand((s) => s.setName('wo').setDescription('[STAFF] Declara W.O. (ausência do adversário) em uma partida')
      .addIntegerOption((o) => o.setName('partida').setDescription('ID da partida').setRequired(true))
      .addUserOption((o) => o.setName('vencedor').setDescription('Quem venceu por W.O.').setRequired(true))),

  async execute(interaction) {
    if (!gc.hasRole(interaction.member, 'cargo_staff')) {
      return erro(interaction, 'Sem permissão', 'Só a staff gerencia eventos.');
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'painel') {
      const canal = interaction.options.getChannel('canal') || interaction.channel;
      gc.set(interaction.guildId, 'canal_eventos', canal.id);
      await eventos.publicarPainel(interaction.client, interaction.guildId);

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ PAINEL DE EVENTOS PUBLICADO'),
        ui.txt(`O painel está em ${canal} e se atualiza sozinho a cada evento criado/encerrado.`),
        ui.nota('Jogadores veem o progresso deles clicando em "MEU PROGRESSO" no painel.'),
      ), { efemero: true }));
    }

    if (sub === 'criar') {
      const id = eventos.criarEvento(interaction.guildId, {
        nome: interaction.options.getString('nome'),
        tipo: interaction.options.getString('tipo'),
        meta: interaction.options.getInteger('meta'),
        premioPontos: interaction.options.getInteger('premio_pontos') ?? 0,
        premioTexto: interaction.options.getString('premio_texto'),
        duracaoDias: interaction.options.getInteger('duracao_dias') ?? 7,
        exigeConsecutivo: interaction.options.getBoolean('exige_consecutivo') ?? false,
        permiteWo: interaction.options.getBoolean('permite_wo') ?? true,
        permiteRevanche: interaction.options.getBoolean('permite_revanche') ?? true,
        criadoPor: interaction.user.id,
      });
      await eventos.publicarPainel(interaction.client, interaction.guildId).catch(() => {});

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ EVENTO CRIADO'),
        ui.nota(`Evento #${id}`),
        ui.txt('O painel fixo de eventos já foi atualizado.'),
      ), { efemero: true }));
    }

    if (sub === 'encerrar') {
      const id = interaction.options.getInteger('id');
      const evento = eventos.getEvento(id);
      if (!evento || evento.guild_id !== interaction.guildId) {
        return erro(interaction, 'Evento não encontrado', `Não existe evento #${id}.`);
      }
      eventos.encerrarEvento(id);
      await eventos.publicarPainel(interaction.client, interaction.guildId).catch(() => {});

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.aviso,
        ui.titulo('🚫 EVENTO ENCERRADO'),
        ui.txt(`**${evento.nome}** foi encerrado antes do prazo.`),
      ), { efemero: true }));
    }

    if (sub === 'wo') {
      const matchId = interaction.options.getInteger('partida');
      const vencedor = interaction.options.getUser('vencedor');
      const m = partida.get(matchId);
      if (!m) return erro(interaction, 'Partida não encontrada', `Não existe partida #${matchId}.`);
      if (!partida.ehJogador(m, vencedor.id)) {
        return erro(interaction, 'Jogador inválido', 'O vencedor precisa ser um dos dois jogadores da partida.');
      }
      if (['FINALIZADA', 'CANCELADA'].includes(m.status)) {
        return erro(interaction, 'Partida encerrada', 'Essa partida já foi finalizada ou cancelada.');
      }

      await interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('🚩 W.O. DECLARADO'),
        ui.txt(`<@${vencedor.id}> venceu por W.O., declarado por <@${interaction.user.id}>.`),
      ), { efemero: true }));

      return partida.finalizarPartida(interaction.client, matchId, vencedor.id,
        `W.O. — ausência do adversário (staff: <@${interaction.user.id}>)`);
    }
  },
};
