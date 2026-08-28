const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const gc = require('../lib/guildconfig');
const loja = require('../features/loja');

const erro = (interaction, titulo, texto) => interaction.reply(ui.msg(
  ui.bloco(cfg.COR.erro, ui.titulo(`❌ ${titulo}`), ui.txt(texto)), { efemero: true },
));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loja')
    .setDescription('[STAFF] Gerencia a loja de pontos')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand((s) => s.setName('painel').setDescription('Publica o painel da loja em um canal')
      .addChannelOption((o) => o.setName('canal').setDescription('Canal do painel (padrão: o atual)')
        .addChannelTypes(ChannelType.GuildText)))

    .addSubcommand((s) => s.setName('add').setDescription('Adiciona um item na loja')
      .addStringOption((o) => o.setName('nome').setDescription('Nome do item').setRequired(true).setMaxLength(80))
      .addIntegerOption((o) => o.setName('preco').setDescription('Preço em pontos').setRequired(true).setMinValue(1))
      .addStringOption((o) => o.setName('descricao').setDescription('O que o jogador recebe').setMaxLength(300))
      .addIntegerOption((o) => o.setName('estoque').setDescription('Quantidade (vazio = ilimitado)').setMinValue(0)))

    .addSubcommand((s) => s.setName('editar').setDescription('Edita um item')
      .addIntegerOption((o) => o.setName('id').setDescription('ID do item').setRequired(true))
      .addIntegerOption((o) => o.setName('preco').setDescription('Novo preço em pontos').setMinValue(1))
      .addIntegerOption((o) => o.setName('estoque').setDescription('Novo estoque (-1 = ilimitado)').setMinValue(-1))
      .addStringOption((o) => o.setName('descricao').setDescription('Nova descrição').setMaxLength(300))
      .addBooleanOption((o) => o.setName('ativo').setDescription('Deixar visível na loja')))

    .addSubcommand((s) => s.setName('remover').setDescription('Tira um item da loja')
      .addIntegerOption((o) => o.setName('id').setDescription('ID do item').setRequired(true)))

    .addSubcommand((s) => s.setName('itens').setDescription('Lista todos os itens, inclusive os inativos'))

    .addSubcommand((s) => s.setName('pedidos').setDescription('Lista os pedidos pendentes')),

  async execute(interaction) {
    if (!gc.hasRole(interaction.member, 'cargo_staff')) {
      return erro(interaction, 'Sem permissão', 'Só a staff pode gerenciar a loja.');
    }
    const sub = interaction.options.getSubcommand();

    if (sub === 'painel') {
      const canal = interaction.options.getChannel('canal') || interaction.channel;
      gc.set(interaction.guildId, 'canal_loja', canal.id);

      const msg = await canal.send(ui.msg(loja.painel(interaction.guildId)));
      gc.set(interaction.guildId, 'mensagem_loja', msg.id);

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ PAINEL DA LOJA PUBLICADO'),
        ui.txt(`A loja está em ${canal} e se atualiza sozinha a cada compra.`),
      ), { efemero: true }));
    }

    if (sub === 'add') {
      const nome = interaction.options.getString('nome');
      const preco = interaction.options.getInteger('preco');
      const descricao = interaction.options.getString('descricao');
      const estoque = interaction.options.getInteger('estoque');

      const info = db.prepare(
        `INSERT INTO loja_itens (guild_id, nome, descricao, preco, estoque, criado_por, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(interaction.guildId, nome, descricao || null, preco,
        estoque === null ? -1 : estoque, interaction.user.id, Date.now());

      await loja.atualizarPainel(interaction.client, interaction.guildId);

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ ITEM ADICIONADO'),
        ui.nota(`Item #${info.lastInsertRowid}`),
        ui.divisor(),
        ui.tabela([
          ['Nome', nome],
          ['Preco', `${preco} pontos`],
          ['Estoque', estoque === null ? 'ilimitado' : String(estoque)],
        ]),
        descricao ? ui.txt(`**Descrição:** ${descricao}`) : null,
      ), { efemero: true }));
    }

    if (sub === 'itens') {
      const itens = loja.todosItens(interaction.guildId);
      if (!itens.length) {
        return interaction.reply(ui.msg(ui.bloco(cfg.COR.neutro,
          ui.titulo('🛒 LOJA VAZIA'),
          ui.txt('Adicione o primeiro item com `/loja add`.'),
        ), { efemero: true }));
      }

      const linhas = itens.map((i) =>
        `${i.ativo ? '🟢' : '⚪'} \`#${i.id}\` **${i.nome}** — ${i.preco} pts\n` +
        `└ ${loja.estoqueTxt(i)} · ${i.vendidos} vendido(s)`);

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.primaria,
        ui.titulo('🛒 ITENS DA LOJA'),
        ui.nota(`${itens.length} item(ns)`),
        ui.divisor(),
        ui.lista(linhas),
      ), { efemero: true }));
    }

    if (sub === 'pedidos') {
      const rows = db.prepare(
        "SELECT * FROM loja_pedidos WHERE guild_id = ? AND status = 'PENDENTE' ORDER BY id"
      ).all(interaction.guildId);

      if (!rows.length) {
        return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
          ui.titulo('✅ NADA PENDENTE'),
          ui.txt('Todos os pedidos foram entregues.'),
        ), { efemero: true }));
      }

      const linhas = rows.map((p) =>
        `\`#${p.id}\` **${p.item_nome}** · <@${p.user_id}> · ${p.preco} pts` +
        (p.thread_id ? `\n└ <#${p.thread_id}>` : ''));

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.aviso,
        ui.titulo('📦 PEDIDOS PENDENTES'),
        ui.nota(`${rows.length} aguardando entrega`),
        ui.divisor(),
        ui.lista(linhas),
      ), { efemero: true }));
    }

    const id = interaction.options.getInteger('id');
    const item = loja.getItem(id);
    if (!item || item.guild_id !== interaction.guildId) {
      return erro(interaction, 'Item não encontrado', `Não existe item #${id} nesta loja.`);
    }

    if (sub === 'remover') {
      db.prepare('UPDATE loja_itens SET ativo = 0 WHERE id = ?').run(id);
      await loja.atualizarPainel(interaction.client, interaction.guildId);
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.aviso,
        ui.titulo('🚫 ITEM REMOVIDO DA LOJA'),
        ui.txt(`**${item.nome}** não aparece mais no painel.`),
        ui.nota('Pedidos já feitos continuam valendo.'),
      ), { efemero: true }));
    }

    if (sub === 'editar') {
      const preco = interaction.options.getInteger('preco');
      const estoque = interaction.options.getInteger('estoque');
      const descricao = interaction.options.getString('descricao');
      const ativo = interaction.options.getBoolean('ativo');

      if (preco === null && estoque === null && descricao === null && ativo === null) {
        return erro(interaction, 'Nada para mudar', 'Informe pelo menos um campo.');
      }

      if (preco !== null) db.prepare('UPDATE loja_itens SET preco = ? WHERE id = ?').run(preco, id);
      if (estoque !== null) db.prepare('UPDATE loja_itens SET estoque = ? WHERE id = ?').run(estoque, id);
      if (descricao !== null) db.prepare('UPDATE loja_itens SET descricao = ? WHERE id = ?').run(descricao, id);
      if (ativo !== null) db.prepare('UPDATE loja_itens SET ativo = ? WHERE id = ?').run(ativo ? 1 : 0, id);

      await loja.atualizarPainel(interaction.client, interaction.guildId);
      const novo = loja.getItem(id);

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ ITEM ATUALIZADO'),
        ui.divisor(),
        ui.tabela([
          ['Nome', novo.nome],
          ['Preco', `${novo.preco} pontos`],
          ['Estoque', loja.estoqueTxt(novo)],
          ['Visivel na loja', novo.ativo ? 'sim' : 'nao'],
        ]),
      ), { efemero: true }));
    }
  },
};
