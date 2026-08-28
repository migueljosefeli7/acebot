const { SlashCommandBuilder, ChannelType } = require('discord.js');

const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const gc = require('../lib/guildconfig');

const erro = (interaction, titulo, texto) => interaction.reply(ui.msg(
  ui.bloco(cfg.COR.erro, ui.titulo(`❌ ${titulo}`), ui.txt(texto)),
  { efemero: true },
));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ia')
    .setDescription('[STAFF] Configura o canal de atendimento por IA')
    .addSubcommand((s) => s.setName('configurar').setDescription('Define o canal em que a IA responderá')
      .addChannelOption((o) => o.setName('canal').setDescription('Canal IA Chat')
        .setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('regras').setDescription('Adiciona regras próprias à base de conhecimento da IA')
      .addStringOption((o) => o.setName('texto').setDescription('Regras adicionais do seu servidor')
        .setRequired(true).setMaxLength(6000)))
    .addSubcommand((s) => s.setName('limpar-contexto').setDescription('Apaga o histórico curto das conversas da IA')
      .addUserOption((o) => o.setName('jogador').setDescription('Vazio limpa o contexto de todos')))
    .addSubcommand((s) => s.setName('desativar').setDescription('Desativa o IA Chat'))
    .addSubcommand((s) => s.setName('ver').setDescription('Mostra a configuração atual da IA')),

  async execute(interaction) {
    if (!gc.hasRole(interaction.member, 'cargo_staff')) {
      return erro(interaction, 'Sem permissão', 'Só a staff pode configurar o IA Chat.');
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'configurar') {
      const canal = interaction.options.getChannel('canal');
      if (canal.id === gc.get(interaction.guildId, 'canal_sugestoes')) {
        return erro(interaction, 'Canal já usado por sugestões', 'Escolha outro canal para não misturar votação com o IA Chat.');
      }
      gc.set(interaction.guildId, 'canal_ia', canal.id);
      return interaction.reply(ui.msg(ui.bloco(cfg.openaiApiKey ? cfg.COR.sucesso : cfg.COR.aviso,
        ui.titulo('🤖 IA CHAT CONFIGURADO'),
        ui.txt(`A IA responderá todas as mensagens comuns enviadas em ${canal}.`),
        ui.divisor(),
        ui.tabela([
          ['Modelo', cfg.openaiModel],
          ['Chave da API', cfg.openaiApiKey ? 'configurada' : 'FALTANDO'],
        ]),
        !cfg.openaiApiKey
          ? ui.txt('⚠️ Coloque `OPENAI_API_KEY` no `.env` e reinicie o bot para começar a responder.')
          : null,
      ), { efemero: true }));
    }

    if (sub === 'regras') {
      const regras = interaction.options.getString('texto').trim();
      gc.set(interaction.guildId, 'ia_regras', regras);
      db.prepare('DELETE FROM ai_conversations WHERE guild_id = ?').run(interaction.guildId);
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('📚 REGRAS DA IA ATUALIZADAS'),
        ui.txt('As novas regras já serão usadas nas próximas respostas.'),
        ui.nota('O contexto anterior foi limpo para a IA não misturar instruções antigas.'),
      ), { efemero: true }));
    }

    if (sub === 'limpar-contexto') {
      const jogador = interaction.options.getUser('jogador');
      const info = jogador
        ? db.prepare('DELETE FROM ai_conversations WHERE guild_id = ? AND user_id = ?')
          .run(interaction.guildId, jogador.id)
        : db.prepare('DELETE FROM ai_conversations WHERE guild_id = ?').run(interaction.guildId);

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('🧹 CONTEXTO LIMPO'),
        ui.txt(jogador
          ? `A próxima conversa de ${jogador} começará do zero.`
          : `O contexto de **${info.changes} jogador(es)** foi apagado.`),
      ), { efemero: true }));
    }

    if (sub === 'desativar') {
      gc.set(interaction.guildId, 'canal_ia', '');
      db.prepare('DELETE FROM ai_conversations WHERE guild_id = ?').run(interaction.guildId);
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.neutro,
        ui.titulo('⏸️ IA CHAT DESATIVADO'),
        ui.txt('A IA não responderá mais automaticamente.'),
      ), { efemero: true }));
    }

    const canalId = gc.get(interaction.guildId, 'canal_ia');
    const regras = gc.get(interaction.guildId, 'ia_regras');
    return interaction.reply(ui.msg(ui.bloco(canalId && cfg.openaiApiKey ? cfg.COR.sucesso : cfg.COR.aviso,
      ui.titulo('🤖 CONFIGURAÇÃO DO IA CHAT'),
      ui.divisor(),
      ui.tabela([
        ['Canal', canalId ? `<#${canalId}>` : 'não configurado'],
        ['Modelo', cfg.openaiModel],
        ['API', cfg.openaiApiKey ? 'configurada' : 'chave ausente'],
        ['Regras adicionais', regras ? 'configuradas' : 'somente regras padrão'],
      ]),
    ), { efemero: true }));
  },
};
