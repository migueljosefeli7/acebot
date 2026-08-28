const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const money = require('../lib/money');
const gc = require('../lib/guildconfig');
const notificar = require('../lib/notificar');
const partida = require('../features/partida');

const erro = (interaction, titulo, texto) => interaction.reply(ui.msg(
  ui.bloco(cfg.COR.erro, ui.titulo(`❌ ${titulo}`), ui.txt(texto)), { efemero: true },
));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('partida')
    .setDescription('[STAFF] Resolve partidas e disputas')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)

    .addSubcommand((s) => s.setName('vencedor').setDescription('Dá o veredito e paga o vencedor')
      .addIntegerOption((o) => o.setName('id').setDescription('ID da partida').setRequired(true))
      .addUserOption((o) => o.setName('jogador').setDescription('Quem venceu').setRequired(true)))

    .addSubcommand((s) => s.setName('anular').setDescription('Anula a partida e devolve o valor aos dois')
      .addIntegerOption((o) => o.setName('id').setDescription('ID da partida').setRequired(true))
      .addStringOption((o) => o.setName('motivo').setDescription('Motivo da anulação')))

    .addSubcommand((s) => s.setName('painel').setDescription('Reposta os botões de veredito no ticket')
      .addIntegerOption((o) => o.setName('id').setDescription('ID da partida').setRequired(true)))

    .addSubcommand((s) => s.setName('abertas').setDescription('Lista as partidas que ainda não foram encerradas')),

  async execute(interaction) {
    if (!gc.hasRole(interaction.member, 'cargo_staff') && !gc.hasRole(interaction.member, 'cargo_staff_ss')) {
      return erro(interaction, 'Sem permissão', 'Só a staff pode usar esse comando.');
    }
    const sub = interaction.options.getSubcommand();

    if (sub === 'abertas') {
      const rows = db.prepare(
        `SELECT * FROM matches WHERE guild_id = ? AND status NOT IN ('FINALIZADA','CANCELADA')
         ORDER BY id DESC LIMIT 20`
      ).all(interaction.guildId);

      if (!rows.length) {
        return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
          ui.titulo('✅ NADA EM ABERTO'),
          ui.txt('Nenhuma partida pendente no momento.'),
        ), { efemero: true }));
      }

      const linhas = rows.map((m) =>
        `\`#${m.id}\` **${m.modalidade}** · ${money.fmt(m.valor)} · <#${m.thread_id}>\n` +
        `└ ${m.status} · <@${m.p1}> vs <@${m.p2}>`);

      const travado = rows.reduce((s, m) => s + m.valor * 2, 0);
      const emDisputa = rows.filter((m) => ['DISPUTA', 'SS_SOLICITADO'].includes(m.status)).length;

      return interaction.reply(ui.msg(ui.bloco(emDisputa ? cfg.COR.erro : cfg.COR.primaria,
        ui.titulo('⚔️ PARTIDAS EM ABERTO'),
        ui.nota(`${rows.length} partida(s) · ${emDisputa} precisando de staff`),
        ui.divisor(),
        ui.lista(linhas),
        ui.divisor(),
        ui.tabela([['Valor total reservado', money.fmt(travado)]]),
      ), { efemero: true }));
    }

    const id = interaction.options.getInteger('id');
    const m = partida.get(id);
    if (!m || m.guild_id !== interaction.guildId) {
      return erro(interaction, 'Partida não encontrada', `Não existe partida #${id} neste servidor.`);
    }

    if (sub === 'painel') {
      const thread = await interaction.client.channels.fetch(m.thread_id).catch(() => null);
      if (!thread) return erro(interaction, 'Ticket inacessível', 'Não consegui abrir o tópico dessa partida.');

      await thread.send(ui.msg(ui.bloco(cfg.COR.erro,
        ui.titulo('⚖️ VEREDITO DA STAFF'),
        ui.nota(`Partida #${m.id} · ${m.modalidade}`),
        ui.divisor(),
        ui.txt(
          `1️⃣ <@${m.p1}>${m.claim_p1 ? ` · declarou **${m.claim_p1}**` : ''}\n` +
          `2️⃣ <@${m.p2}>${m.claim_p2 ? ` · declarou **${m.claim_p2}**` : ''}`
        ),
        ui.tabela([['Premio ao vencedor', money.fmt(partida.premio(m))]]),
        await partida.botoesVeredito(interaction.client, m),
      )));

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.comBotao(
          '## ✅ Botões de veredito enviados',
          ui.botaoLink(notificar.linkPara(m.guild_id, m.thread_id), 'ABRIR TICKET', '⚔️'),
        ),
      ), { efemero: true }));
    }

    if (m.status === 'FINALIZADA' || m.status === 'CANCELADA') {
      return erro(interaction, 'Partida encerrada', `A partida #${id} já está **${m.status}**.`);
    }

    if (sub === 'vencedor') {
      const vencedor = interaction.options.getUser('jogador');
      if (!partida.ehJogador(m, vencedor.id)) {
        return erro(interaction, 'Jogador errado', 'Esse jogador não participou da partida.');
      }
      db.prepare('UPDATE matches SET staff_id = ? WHERE id = ?').run(interaction.user.id, id);

      await interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('⚖️ VEREDITO APLICADO'),
        ui.divisor(),
        ui.txt(`Vencedor: ${vencedor}`),
        ui.tabela([['Premio creditado', money.fmt(partida.premio(m))]]),
      ), { efemero: true }));

      return partida.finalizarPartida(interaction.client, id, vencedor.id,
        `Veredito da staff · <@${interaction.user.id}>`);
    }

    if (sub === 'anular') {
      const motivo = interaction.options.getString('motivo') || 'Anulada pela staff';

      await interaction.reply(ui.msg(ui.bloco(cfg.COR.aviso,
        ui.titulo('🚫 ANULANDO A PARTIDA'),
        ui.divisor(),
        ui.tabela([
          ['Partida', `#${id} ${m.modalidade}`],
          ['Devolvido para cada um', money.fmt(m.valor)],
        ]),
        ui.nota(motivo),
      ), { efemero: true }));

      return partida.cancelarPartida(interaction.client, id, `${motivo} (<@${interaction.user.id}>)`);
    }
  },
};
