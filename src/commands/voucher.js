const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const money = require('../lib/money');
const gc = require('../lib/guildconfig');
const voucher = require('../features/voucher');

const erro = (interaction, titulo, texto) => interaction.reply(ui.msg(
  ui.bloco(cfg.COR.erro, ui.titulo(`❌ ${titulo}`), ui.txt(texto)), { efemero: true },
));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('voucher')
    .setDescription('[STAFF] Cria e gerencia vouchers de saldo')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand((s) => s.setName('criar').setDescription('Cria um voucher de saldo')
      .addStringOption((o) => o.setName('valor').setDescription('Valor creditado por resgate. Ex: 10 ou 10,50').setRequired(true))
      .addIntegerOption((o) => o.setName('usos').setDescription('Quantas pessoas podem resgatar (padrão: 1)').setMinValue(1).setMaxValue(10000))
      .addUserOption((o) => o.setName('exclusivo').setDescription('Só esse jogador pode resgatar'))
      .addIntegerOption((o) => o.setName('validade_horas').setDescription('Expira em quantas horas (padrão: sem prazo)').setMinValue(1))
      .addStringOption((o) => o.setName('descricao').setDescription('Aparece para o jogador ao resgatar'))
      .addStringOption((o) => o.setName('codigo').setDescription('Código personalizado (padrão: gerado automaticamente)')))

    .addSubcommand((s) => s.setName('listar').setDescription('Lista os vouchers do servidor')
      .addBooleanOption((o) => o.setName('so_ativos').setDescription('Mostrar apenas os que ainda dá para resgatar')))

    .addSubcommand((s) => s.setName('ver').setDescription('Detalhes e quem já resgatou um voucher')
      .addStringOption((o) => o.setName('codigo').setDescription('Código do voucher').setRequired(true)))

    .addSubcommand((s) => s.setName('desativar').setDescription('Desativa um voucher (quem já resgatou mantém o saldo)')
      .addStringOption((o) => o.setName('codigo').setDescription('Código do voucher').setRequired(true))),

  async execute(interaction) {
    if (!gc.hasRole(interaction.member, 'cargo_staff')) {
      return erro(interaction, 'Sem permissão', 'Só a staff pode gerenciar vouchers.');
    }
    const sub = interaction.options.getSubcommand();

    if (sub === 'criar') {
      const amount = money.parse(interaction.options.getString('valor'));
      if (amount === null || amount <= 0) return erro(interaction, 'Valor inválido', 'Use `10` ou `10,50`.');

      const usos = interaction.options.getInteger('usos') || 1;
      const exclusivo = interaction.options.getUser('exclusivo');
      const horas = interaction.options.getInteger('validade_horas');
      const descricao = interaction.options.getString('descricao');

      let code = interaction.options.getString('codigo');
      code = code ? voucher.normalizar(code) : voucher.gerarCodigo();
      if (!/^[A-Z0-9-]{4,40}$/.test(code)) {
        return erro(interaction, 'Código inválido', 'Use só letras, números e hífen (4 a 40 caracteres).');
      }
      if (voucher.get(code)) return erro(interaction, 'Código já existe', `Já existe um voucher \`${code}\`.`);

      db.prepare(
        `INSERT INTO vouchers (code, guild_id, amount, max_uses, restrito_a, descricao, criado_por, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(code, interaction.guildId, amount, usos, exclusivo?.id || null, descricao || null,
        interaction.user.id, horas ? Date.now() + horas * 3600_000 : null, Date.now());

      return interaction.reply(ui.msg([
        ui.bloco(cfg.COR.sucesso,
          ui.titulo('✅ VOUCHER CRIADO'),
          ui.txt('Mande esse código para quem vai usar:'),
          ui.txt('```\n' + code + '\n```'),
          ui.nota(`Custo máximo para a organização: ${money.fmt(amount * usos)}`)),
        voucher.painelVoucher(voucher.get(code)),
      ], { efemero: true }));
    }

    if (sub === 'listar') {
      const soAtivos = interaction.options.getBoolean('so_ativos') ?? false;
      const rows = voucher.listar(interaction.guildId, soAtivos);
      if (!rows.length) {
        return interaction.reply(ui.msg(ui.bloco(cfg.COR.neutro,
          ui.titulo('🎟️ NENHUM VOUCHER'),
          ui.txt('Crie o primeiro com `/voucher criar`.'),
        ), { efemero: true }));
      }

      const linhas = rows.map((v) => {
        const alvo = v.restrito_a ? ` · exclusivo <@${v.restrito_a}>` : '';
        return `${voucher.estadoDe(v).slice(0, 2)} \`${v.code}\` — **${money.fmt(v.amount)}** · ${v.uses}/${v.max_uses}${alvo}`;
      });

      const naRua = rows
        .filter((v) => v.ativo && v.uses < v.max_uses && (!v.expires_at || v.expires_at > Date.now()))
        .reduce((soma, v) => soma + v.amount * (v.max_uses - v.uses), 0);
      const jaGasto = rows.reduce((soma, v) => soma + v.amount * v.uses, 0);

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.primaria,
        ui.titulo('🎟️ VOUCHERS DO SERVIDOR'),
        ui.nota(`${rows.length} listado(s)`),
        ui.divisor(),
        ui.lista(linhas),
        ui.divisor(),
        ui.tabela([
          ['Ja resgatado', money.fmt(jaGasto)],
          ['Exposicao em aberto', money.fmt(naRua)],
        ]),
        ui.nota('Exposição em aberto = quanto ainda pode ser resgatado.'),
      ), { efemero: true }));
    }

    const code = voucher.normalizar(interaction.options.getString('codigo'));
    const v = voucher.get(code);
    if (!v || v.guild_id !== interaction.guildId) {
      return erro(interaction, 'Voucher não encontrado', `Não existe \`${code}\` neste servidor.`);
    }

    if (sub === 'ver') {
      const lista = voucher.usos(code);
      const resgates = lista.map((u) =>
        `<@${u.user_id}> — ${money.fmt(u.amount)} · <t:${Math.floor(u.used_at / 1000)}:R>`);

      return interaction.reply(ui.msg([
        voucher.painelVoucher(v),
        ui.bloco(cfg.COR.neutro,
          ui.titulo('👥 QUEM RESGATOU'),
          ui.divisor(),
          ui.lista(resgates)),
      ], { efemero: true }));
    }

    if (sub === 'desativar') {
      if (!v.ativo) {
        return interaction.reply(ui.msg(ui.bloco(cfg.COR.neutro,
          ui.titulo('⚪ JÁ ESTAVA DESATIVADO'),
          ui.txt(`O voucher \`${code}\` já estava fora do ar.`),
        ), { efemero: true }));
      }
      db.prepare('UPDATE vouchers SET ativo = 0 WHERE code = ?').run(code);

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.aviso,
        ui.titulo('🚫 VOUCHER DESATIVADO'),
        ui.txt(`\`${code}\` não pode mais ser resgatado.`),
        ui.divisor(),
        ui.tabela([
          ['Resgates ja feitos', `${v.uses}/${v.max_uses}`],
          ['Valor ja entregue', money.fmt(v.amount * v.uses)],
        ]),
        ui.nota('Quem já resgatou mantém o saldo.'),
      ), { efemero: true }));
    }
  },
};
