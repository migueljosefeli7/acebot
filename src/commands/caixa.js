const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const cfg = require('../config');
const ui = require('../lib/ui');
const gc = require('../lib/guildconfig');
const caixas = require('../features/caixas');

const erro = (interaction, titulo, texto) => interaction.reply(ui.msg(
  ui.bloco(cfg.COR.erro, ui.titulo(`❌ ${titulo}`), ui.txt(texto)), { efemero: true },
));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('caixa')
    .setDescription('[STAFF] Gerencia o sistema de caixas (roleta) de pontos')

    .addSubcommand((s) => s.setName('listar').setDescription('[STAFF] Lista as caixas do servidor'))

    .addSubcommand((s) => s.setName('criar').setDescription('[STAFF] Cria uma nova caixa')
      .addStringOption((o) => o.setName('nome').setDescription('Nome da caixa').setRequired(true).setMaxLength(60))
      .addIntegerOption((o) => o.setName('preco').setDescription('Preço em pontos').setRequired(true).setMinValue(1))
      .addStringOption((o) => o.setName('descricao').setDescription('Descrição da caixa').setMaxLength(300))
      .addStringOption((o) => o.setName('imagem').setDescription('URL de uma imagem/banner')))

    .addSubcommand((s) => s.setName('premio').setDescription('[STAFF] Adiciona um prêmio a uma caixa')
      .addIntegerOption((o) => o.setName('caixa').setDescription('ID da caixa').setRequired(true))
      .addStringOption((o) => o.setName('nome').setDescription('Nome do prêmio').setRequired(true).setMaxLength(80))
      .addIntegerOption((o) => o.setName('peso').setDescription('Peso no sorteio (quanto maior, mais chance)').setRequired(true).setMinValue(1)))

    .addSubcommand((s) => s.setName('painel').setDescription('[STAFF] Publica o painel de uma caixa em um canal')
      .addIntegerOption((o) => o.setName('id').setDescription('ID da caixa').setRequired(true))
      .addChannelOption((o) => o.setName('canal').setDescription('Canal (padrão: o atual)').addChannelTypes(ChannelType.GuildText)))

    .addSubcommand((s) => s.setName('desativar').setDescription('[STAFF] Desativa uma caixa')
      .addIntegerOption((o) => o.setName('id').setDescription('ID da caixa').setRequired(true))),

  async execute(interaction) {
    if (!gc.hasRole(interaction.member, 'cargo_staff')) {
      return erro(interaction, 'Sem permissão', 'Só a staff gerencia caixas.');
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'listar') {
      return interaction.reply(ui.msg(caixas.painelListagem(interaction.guildId), { efemero: true }));
    }

    if (sub === 'criar') {
      const nome = interaction.options.getString('nome');
      const preco = interaction.options.getInteger('preco');
      const descricao = interaction.options.getString('descricao');
      const imagem = interaction.options.getString('imagem');

      const id = caixas.criarCaixa(interaction.guildId, {
        nome, preco, descricao, imagemUrl: imagem, criadoPor: interaction.user.id,
      });

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ CAIXA CRIADA'),
        ui.nota(`Caixa #${id}`),
        ui.txt(`Use \`/caixa premio caixa:${id}\` para adicionar os prêmios antes de publicar.`),
      ), { efemero: true }));
    }

    if (sub === 'premio') {
      const caixaId = interaction.options.getInteger('caixa');
      const caixa = caixas.getCaixa(caixaId);
      if (!caixa || caixa.guild_id !== interaction.guildId) {
        return erro(interaction, 'Caixa não encontrada', `Não existe caixa #${caixaId}.`);
      }

      const nome = interaction.options.getString('nome');
      const peso = interaction.options.getInteger('peso');
      caixas.addPremio(caixaId, { nome, peso });

      const todos = caixas.chances(caixas.getPremios(caixaId));
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ PRÊMIO ADICIONADO'),
        ui.divisor(),
        ui.txt(todos.map((p) => `**${p.nome}** — \`${p.chance.toFixed(1)}%\``).join('\n')),
      ), { efemero: true }));
    }

    if (sub === 'painel') {
      const id = interaction.options.getInteger('id');
      const caixa = caixas.getCaixa(id);
      if (!caixa || caixa.guild_id !== interaction.guildId) {
        return erro(interaction, 'Caixa não encontrada', `Não existe caixa #${id}.`);
      }
      const canal = interaction.options.getChannel('canal') || interaction.channel;
      await canal.send(ui.msg(caixas.painelCaixa(caixa)));

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ PAINEL PUBLICADO'),
        ui.txt(`A caixa **${caixa.nome}** está disponível em ${canal}.`),
      ), { efemero: true }));
    }

    if (sub === 'desativar') {
      const id = interaction.options.getInteger('id');
      const caixa = caixas.getCaixa(id);
      if (!caixa || caixa.guild_id !== interaction.guildId) {
        return erro(interaction, 'Caixa não encontrada', `Não existe caixa #${id}.`);
      }
      require('../db/database').prepare('UPDATE caixas SET ativo = 0 WHERE id = ?').run(id);
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.aviso,
        ui.titulo('🚫 CAIXA DESATIVADA'),
        ui.txt(`**${caixa.nome}** não pode mais ser aberta.`),
      ), { efemero: true }));
    }
  },
};
