const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const cfg = require('../config');
const ui = require('../lib/ui');
const gc = require('../lib/guildconfig');
const elo = require('../features/elo');
const ranking = require('../features/ranking');

const erro = (interaction, titulo, texto) => interaction.reply(ui.msg(
  ui.bloco(cfg.COR.erro, ui.titulo(`❌ ${titulo}`), ui.txt(texto)), { efemero: true },
));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('elo')
    .setDescription('Elos, pontos e cargos de ranqueada')

    .addSubcommand((s) => s.setName('ver').setDescription('Mostra o elo e os pontos de alguém')
      .addUserOption((o) => o.setName('jogador').setDescription('Padrão: você mesmo')))

    .addSubcommand((s) => s.setName('escada').setDescription('Mostra a escada completa de elos'))

    .addSubcommand((s) => s.setName('criar-cargos')
      .setDescription('[ADMIN] Cria automaticamente os 25 cargos de elo e vincula'))

    .addSubcommand((s) => s.setName('vincular').setDescription('[ADMIN] Liga um cargo já existente a um elo')
      .addStringOption((o) => o.setName('elo').setDescription('Qual elo').setRequired(true).setAutocomplete(true))
      .addRoleOption((o) => o.setName('cargo').setDescription('O cargo').setRequired(true)))

    .addSubcommand((s) => s.setName('cargos').setDescription('[ADMIN] Mostra os cargos vinculados'))

    .addSubcommand((s) => s.setName('dar').setDescription('[ADMIN] Dá ou tira pontos de um jogador')
      .addUserOption((o) => o.setName('jogador').setDescription('Quem').setRequired(true))
      .addIntegerOption((o) => o.setName('pontos').setDescription('Use negativo para tirar').setRequired(true))
      .addStringOption((o) => o.setName('motivo').setDescription('Aparece no extrato de pontos')))

    .addSubcommand((s) => s.setName('sincronizar')
      .setDescription('[ADMIN] Reaplica os cargos de elo e de pódio em todo mundo')),

  async autocomplete(interaction) {
    const digitado = interaction.options.getFocused().toLowerCase();
    const opcoes = elo.ELOS
      .filter((e) => e.nome.toLowerCase().includes(digitado) || e.key.toLowerCase().includes(digitado))
      .slice(0, 25)
      .map((e) => ({ name: `${e.emoji} ${e.nome} (${e.min} pts)`, value: e.key }));
    return interaction.respond(opcoes);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const admin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

    if (sub === 'ver') {
      const alvo = interaction.options.getUser('jogador') || interaction.user;
      return interaction.reply(ui.msg(elo.painelElo(alvo), { efemero: true }));
    }

    if (sub === 'escada') {
      const linhas = elo.ELOS.map((e) => `${e.emoji} **${e.nome}** — \`${e.min} pts\``);
      const meio = Math.ceil(linhas.length / 2);
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.primaria,
        ui.titulo('🪜 ESCADA DE ELOS'),
        ui.nota(`${elo.ELOS.length} degraus · ${elo.PONTOS_POR_DIVISAO} pontos por divisão`),
        ui.divisor(),
        ui.txt(linhas.slice(0, meio).join('\n')),
        ui.txt(linhas.slice(meio).join('\n')),
        ui.divisor(),
        ui.tabela([
          ['Pontos por vitoria', `+${cfg.pontosVitoria}`],
          ['Pontos por derrota', `-${cfg.pontosDerrota}`],
        ]),
      ), { efemero: true }));
    }

    if (!admin) return erro(interaction, 'Sem permissão', 'Só administradores usam essa parte do comando.');

    if (sub === 'criar-cargos') {
      await interaction.deferReply({ flags: ui.EFEMERO });
      const criados = [];
      const reusados = [];

      for (const e of elo.ELOS) {
        const nome = `${e.emoji} ${e.nome}`;
        let role = interaction.guild.roles.cache.find((r) => r.name === nome);
        if (role) {
          reusados.push(nome);
        } else {
          try {
            role = await interaction.guild.roles.create({
              name: nome, color: e.cor, hoist: false, mentionable: false,
              reason: 'Cargo de elo do sistema de ranqueada',
            });
            criados.push(nome);
          } catch (err) {
            return interaction.editReply(ui.msg(ui.bloco(cfg.COR.erro,
              ui.titulo('❌ Não consegui criar os cargos'),
              ui.txt(`Erro em **${nome}**: ${err.message}\n\n` +
                'O bot precisa da permissão **Gerenciar Cargos** e o cargo dele precisa estar ' +
                'acima na lista.'),
            )));
          }
        }
        elo.definirCargo(interaction.guildId, e.key, role.id);
      }

      return interaction.editReply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ CARGOS DE ELO PRONTOS'),
        ui.divisor(),
        ui.tabela([
          ['Criados agora', String(criados.length)],
          ['Ja existiam', String(reusados.length)],
          ['Total vinculado', String(elo.ELOS.length)],
        ]),
        ui.nota('Arraste o cargo do bot para CIMA dos cargos de elo, senão ele não consegue aplicá-los.'),
      )));
    }

    if (sub === 'vincular') {
      const key = interaction.options.getString('elo');
      const cargo = interaction.options.getRole('cargo');
      if (!elo.porKey(key)) return erro(interaction, 'Elo inválido', `Não existe o elo \`${key}\`.`);

      elo.definirCargo(interaction.guildId, key, cargo.id);
      const e = elo.porKey(key);
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ CARGO VINCULADO'),
        ui.txt(`${e.emoji} **${e.nome}** → ${cargo}`),
      ), { efemero: true }));
    }

    if (sub === 'cargos') {
      const mapa = elo.todosOsCargos(interaction.guildId);
      const linhas = elo.ELOS.map((e) => {
        const r = mapa.find((c) => c.elo === e.key);
        return `${r ? '🟢' : '🔴'} ${e.emoji} **${e.nome}** — ${r ? `<@&${r.role_id}>` : '`sem cargo`'}`;
      });
      const meio = Math.ceil(linhas.length / 2);

      return interaction.reply(ui.msg(ui.bloco(mapa.length === elo.ELOS.length ? cfg.COR.sucesso : cfg.COR.aviso,
        ui.titulo('🎖️ CARGOS DE ELO'),
        ui.nota(`${mapa.length}/${elo.ELOS.length} vinculados`),
        ui.divisor(),
        ui.txt(linhas.slice(0, meio).join('\n')),
        ui.txt(linhas.slice(meio).join('\n')),
      ), { efemero: true }));
    }

    if (sub === 'dar') {
      const alvo = interaction.options.getUser('jogador');
      const pontos = interaction.options.getInteger('pontos');
      const motivo = interaction.options.getString('motivo') || 'Ajuste manual da administração';
      if (pontos === 0) return erro(interaction, 'Valor inválido', 'Use um número diferente de zero.');

      await interaction.deferReply({ flags: ui.EFEMERO });
      const r = await elo.registrar(interaction.client, interaction.guildId, alvo.id, pontos,
        motivo, `admin:${interaction.user.id}`);
      await ranking.atualizarTudo(interaction.client, interaction.guildId);

      return interaction.editReply(ui.msg(ui.bloco(pontos > 0 ? cfg.COR.sucesso : cfg.COR.erro,
        ui.titulo(pontos > 0 ? '✅ PONTOS ADICIONADOS' : '✅ PONTOS REMOVIDOS'),
        ui.txt(`Jogador: ${alvo}`),
        ui.divisor(),
        ui.tabela([
          ['Variacao', `${r.delta >= 0 ? '+' : ''}${r.delta}`],
          ['Pontos agora', String(r.depois)],
          ['Elo', `${r.eloDepois.emoji} ${r.eloDepois.nome}`],
        ]),
        r.subiu ? ui.txt('📈 Subiu de elo.') : r.caiu ? ui.txt('📉 Caiu de elo.') : null,
        ui.nota(motivo),
      )));
    }

    if (sub === 'sincronizar') {
      await interaction.deferReply({ flags: ui.EFEMERO });
      const jogadores = require('../db/database')
        .prepare('SELECT discord_id, pontos FROM users WHERE pontos > 0').all();

      let ok = 0;
      let falhou = 0;
      for (const j of jogadores) {
        const r = await elo.sincronizarCargo(interaction.client, interaction.guildId,
          j.discord_id, elo.eloDe(j.pontos).key);
        r.ok ? ok++ : falhou++;
      }
      await ranking.atualizarTudo(interaction.client, interaction.guildId);

      return interaction.editReply(ui.msg(ui.bloco(falhou ? cfg.COR.aviso : cfg.COR.sucesso,
        ui.titulo('🔄 SINCRONIZAÇÃO CONCLUÍDA'),
        ui.divisor(),
        ui.tabela([
          ['Jogadores processados', String(jogadores.length)],
          ['Cargos aplicados', String(ok)],
          ['Falhas', String(falhou)],
        ]),
        falhou ? ui.nota('Falhas costumam ser hierarquia: suba o cargo do bot.') : null,
      )));
    }
  },
};
