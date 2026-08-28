const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const money = require('../lib/money');
const wallet = require('../lib/wallet');
const fila = require('../features/fila');

const erro = (interaction, titulo, texto) => interaction.reply(ui.msg(
  ui.bloco(cfg.COR.erro, ui.titulo(`❌ ${titulo}`), ui.txt(texto)), { efemero: true },
));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('fila')
    .setDescription('Gerencia os painéis de fila das modalidades')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    .addSubcommand((s) => s.setName('criar').setDescription('Cria um painel de fila em um canal')
      .addStringOption((o) => o.setName('modalidade').setDescription('Modalidade da partida').setRequired(true)
        .addChoices(...fila.MODALIDADES.map((m) => ({ name: m, value: m }))))
      .addStringOption((o) => o.setName('valor').setDescription('Valor da partida por jogador. Ex: 50 ou 50,00').setRequired(true))
      .addChannelOption((o) => o.setName('canal').setDescription('Canal do painel (padrão: o atual)').addChannelTypes(ChannelType.GuildText))
      .addStringOption((o) => o.setName('banner').setDescription('URL da imagem/banner do painel')))

    .addSubcommand((s) => s.setName('listar').setDescription('Lista as filas do servidor'))

    .addSubcommand((s) => s.setName('remover').setDescription('Desativa uma fila e devolve o saldo de quem estava nela')
      .addIntegerOption((o) => o.setName('id').setDescription('ID da fila (veja em /fila listar)').setRequired(true)))

    .addSubcommand((s) => s.setName('republicar').setDescription('Reposta o painel de uma fila (se a mensagem sumiu)')
      .addIntegerOption((o) => o.setName('id').setDescription('ID da fila').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'criar') {
      const modalidade = interaction.options.getString('modalidade');
      const valor = money.parse(interaction.options.getString('valor'));
      const canal = interaction.options.getChannel('canal') || interaction.channel;
      const banner = interaction.options.getString('banner');

      if (valor === null || valor <= 0) return erro(interaction, 'Valor inválido', 'Use `50` ou `50,00`.');
      if (valor * 2 <= cfg.taxaPartida) {
        return erro(interaction, 'Valor baixo demais',
          `O prêmio precisa cobrir a taxa da organização (${money.fmt(cfg.taxaPartida)}).`);
      }

      const info = db.prepare(
        'INSERT INTO queues (guild_id, channel_id, modalidade, valor, banner, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(interaction.guildId, canal.id, modalidade, valor, banner || null, Date.now());

      const q = fila.getQueue(info.lastInsertRowid);
      await fila.publicarPainel(canal, q);

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ FILA CRIADA'),
        ui.nota(`Fila #${q.id} · publicada em ${canal}`),
        ui.divisor(),
        ui.tabela([
          ['Modalidade', modalidade],
          ['Valor por jogador', money.fmt(valor)],
          ['Premio ao vencedor', money.fmt(valor * 2 - cfg.taxaPartida)],
          ['Taxa da organizacao', money.fmt(cfg.taxaPartida)],
        ]),
      ), { efemero: true }));
    }

    if (sub === 'listar') {
      const rows = db.prepare('SELECT * FROM queues WHERE guild_id = ? ORDER BY id').all(interaction.guildId);
      if (!rows.length) {
        return interaction.reply(ui.msg(ui.bloco(cfg.COR.neutro,
          ui.titulo('📋 NENHUMA FILA'),
          ui.txt('Crie a primeira com `/fila criar`.'),
        ), { efemero: true }));
      }

      const linhas = rows.map((q) => {
        const n = fila.entradas(q.id).length;
        return `${q.ativo ? '🟢' : '⚪'} \`#${q.id}\` **${q.modalidade}** · ${money.fmt(q.valor)}\n` +
          `└ <#${q.channel_id}> · ${n} na fila`;
      });

      const ativas = rows.filter((q) => q.ativo).length;
      const naFila = rows.reduce((s, q) => s + fila.entradas(q.id).length, 0);

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.primaria,
        ui.titulo('📋 FILAS DO SERVIDOR'),
        ui.nota(`${ativas} ativa(s) de ${rows.length} · ${naFila} jogador(es) na fila agora`),
        ui.divisor(),
        ui.lista(linhas),
      ), { efemero: true }));
    }

    const id = interaction.options.getInteger('id');
    const q = fila.getQueue(id);
    if (!q || q.guild_id !== interaction.guildId) {
      return erro(interaction, 'Fila não encontrada', `Não existe fila #${id} neste servidor.`);
    }

    if (sub === 'remover') {
      const devolvidos = fila.entradas(id);
      for (const e of devolvidos) {
        try {
          wallet.unlock(e.user_id, q.valor);
        } catch { /* trava ja resolvida */ }
      }
      db.prepare('DELETE FROM queue_entries WHERE queue_id = ?').run(id);
      db.prepare('UPDATE queues SET ativo = 0 WHERE id = ?').run(id);

      try {
        const ch = await interaction.client.channels.fetch(q.channel_id);
        const msg = await ch.messages.fetch(q.message_id);
        await msg.delete();
      } catch { /* mensagem ja apagada */ }

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.aviso,
        ui.titulo('🚫 FILA DESATIVADA'),
        ui.divisor(),
        ui.tabela([
          ['Fila', `#${id} ${q.modalidade}`],
          ['Jogadores estornados', String(devolvidos.length)],
          ['Total devolvido', money.fmt(devolvidos.length * q.valor)],
        ]),
      ), { efemero: true }));
    }

    if (sub === 'republicar') {
      const ch = await interaction.client.channels.fetch(q.channel_id);
      await fila.publicarPainel(ch, q);
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ PAINEL REPUBLICADO'),
        ui.txt(`Fila \`#${id}\` está de volta em ${ch}.`),
      ), { efemero: true }));
    }
  },
};
