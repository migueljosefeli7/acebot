const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const cfg = require('../config');
const ui = require('../lib/ui');
const money = require('../lib/money');
const gc = require('../lib/guildconfig');

const CANAIS = Object.entries(cfg.CONFIG_KEYS).filter(([k]) => k.startsWith('canal_'));
const CARGOS = Object.entries(cfg.CONFIG_KEYS).filter(([k]) => k.startsWith('cargo_'));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configura os canais e cargos do bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) => s.setName('canal').setDescription('Define um canal do sistema')
      .addStringOption((o) => o.setName('opcao').setDescription('Qual canal').setRequired(true)
        .addChoices(...CANAIS.map(([k, v]) => ({ name: v.slice(0, 100), value: k }))))
      .addChannelOption((o) => o.setName('canal').setDescription('O canal').setRequired(true)))
    .addSubcommand((s) => s.setName('cargo').setDescription('Define um cargo do sistema')
      .addStringOption((o) => o.setName('opcao').setDescription('Qual cargo').setRequired(true)
        .addChoices(...CARGOS.map(([k, v]) => ({ name: v.slice(0, 100), value: k }))))
      .addRoleOption((o) => o.setName('cargo').setDescription('O cargo').setRequired(true)))
    .addSubcommand((s) => s.setName('ver').setDescription('Mostra a configuração atual')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'canal' || sub === 'cargo') {
      const key = interaction.options.getString('opcao');
      const alvo = sub === 'canal'
        ? interaction.options.getChannel('canal')
        : interaction.options.getRole('cargo');
      gc.set(interaction.guildId, key, alvo.id);

      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ CONFIGURAÇÃO SALVA'),
        ui.divisor(),
        ui.txt(`**${cfg.CONFIG_KEYS[key]}**\n└ ${alvo}`),
        ui.nota(`chave: ${key}`),
      ), { efemero: true }));
    }

    const atual = gc.all(interaction.guildId);
    const faltando = Object.keys(cfg.CONFIG_KEYS).filter((k) => !atual[k]);

    const linhas = (prefixo) => Object.entries(cfg.CONFIG_KEYS)
      .filter(([k]) => k.startsWith(prefixo))
      .map(([k, desc]) => {
        const v = atual[k];
        const alvo = v ? (prefixo === 'cargo_' ? `<@&${v}>` : `<#${v}>`) : '`não configurado`';
        return `${v ? '🟢' : '🔴'} ${desc}\n└ ${alvo}`;
      }).join('\n');

    return interaction.reply(ui.msg(ui.bloco(faltando.length ? cfg.COR.aviso : cfg.COR.sucesso,
      ui.titulo('⚙️ CONFIGURAÇÃO DO SERVIDOR'),
      ui.nota(faltando.length
        ? `${faltando.length} item(ns) ainda sem configurar`
        : 'tudo configurado'),
      ui.divisor(),
      ui.secao('📺 Canais'),
      ui.txt(linhas('canal_')),
      ui.divisor(),
      ui.secao('👮 Cargos'),
      ui.txt(linhas('cargo_')),
      ui.divisor(),
      ui.secao('💵 Regras financeiras'),
      ui.tabela([
        ['Taxa por partida', money.fmt(cfg.taxaPartida)],
        ['Deposito minimo', money.fmt(cfg.depositoMinimo)],
        ['Saque minimo', money.fmt(cfg.saqueMinimo)],
        ['Modo teste de pagamento', cfg.fakePayments ? 'LIGADO' : 'desligado'],
      ]),
    ), { efemero: true }));
  },
};
