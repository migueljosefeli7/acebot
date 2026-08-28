const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const money = require('../lib/money');
const gc = require('../lib/guildconfig');
const emo = require('../lib/emojis');

const getStreamer = (guildId, userId) =>
  db.prepare('SELECT * FROM streamers WHERE guild_id = ? AND user_id = ?').get(guildId, userId);

const listarAtivos = (guildId) =>
  db.prepare('SELECT * FROM streamers WHERE guild_id = ? AND ativo = 1 ORDER BY ao_vivo DESC, user_id ASC').all(guildId);

const temFilaAtiva = (guildId, userId) =>
  !!db.prepare('SELECT 1 FROM queues WHERE guild_id = ? AND streamer_id = ? AND ativo = 1').get(guildId, userId);

function registrar(guildId, userId, { modo = 'BASICO', link } = {}) {
  db.prepare(
    `INSERT INTO streamers (user_id, guild_id, modo, link, ativo, created_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(user_id, guild_id) DO UPDATE SET modo = excluded.modo, link = COALESCE(excluded.link, streamers.link), ativo = 1`
  ).run(userId, guildId, modo, link || null, Date.now());
  return getStreamer(guildId, userId);
}

function remover(guildId, userId) {
  db.prepare('UPDATE streamers SET ativo = 0, ao_vivo = 0 WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

function setStatus(guildId, userId, aoVivo, { link, titulo } = {}) {
  const atual = getStreamer(guildId, userId);
  if (!atual || !atual.ativo) return { erro: 'NAO_CADASTRADO' };

  db.prepare(
    `UPDATE streamers SET ao_vivo = ?, link = COALESCE(?, link), titulo = ? WHERE guild_id = ? AND user_id = ?`
  ).run(aoVivo ? 1 : 0, link || null, aoVivo ? (titulo || null) : atual.titulo, guildId, userId);

  return { ok: true, streamer: getStreamer(guildId, userId) };
}

function registrarMensagem(guildId, userId, canalId, mensagemId) {
  db.prepare('UPDATE streamers SET canal_id = ?, mensagem_id = ? WHERE guild_id = ? AND user_id = ?')
    .run(canalId, mensagemId, guildId, userId);
}

/* ---------------------------------------------------------------- PAINEL */

function painelStreamer(streamer, { filaAtiva = false } = {}) {
  const cor = streamer.ao_vivo ? cfg.COR.erro : cfg.COR.neutro;
  return ui.bloco(cor,
    ui.titulo(`${emo.streamer} <@${streamer.user_id}>`),
    ui.nota(streamer.ao_vivo ? '🔴 AO VIVO AGORA' : '⚫ Offline'),
    ui.divisor(),
    streamer.titulo ? ui.txt(`**${streamer.titulo}**`) : null,
    streamer.link ? ui.comBotao(
      streamer.ao_vivo ? 'Assista agora:' : 'Último link salvo:',
      ui.botaoLink(streamer.link, 'ASSISTIR', '📺'),
    ) : ui.txt('_Nenhum link cadastrado ainda._'),
    ui.nota(`Modo: ${streamer.modo === 'AVANCADO' ? 'Avançado' : 'Básico'}${filaAtiva ? ' · 🎯 fila de desafio aberta' : ''}`),
    ui.divisor(),
    ui.linhaBotoes(
      streamer.ao_vivo
        ? ui.botao(`streamer:offline:${streamer.user_id}`, 'FICAR OFFLINE', { estilo: ui.ESTILO.Secondary, emoji: '⚫' })
        : ui.botao(`streamer:aovivo:${streamer.user_id}`, 'FICAR AO VIVO', { estilo: ui.ESTILO.Danger, emoji: '🔴' }),
      filaAtiva
        ? ui.botao(`streamer:fecharfila:${streamer.user_id}`, 'FECHAR FILA', { estilo: ui.ESTILO.Secondary, emoji: '🔒' })
        : ui.botao(`streamer:abrirfila:${streamer.user_id}`, 'ABRIR FILA DE DESAFIO', { estilo: ui.ESTILO.Success, emoji: '⚔️' }),
    ),
    ui.nota('Só o próprio streamer consegue usar os botões acima.'),
  );
}

function painelListagem(guildId) {
  const ativos = listarAtivos(guildId);
  const aoVivo = ativos.filter((s) => s.ao_vivo);
  const offline = ativos.filter((s) => !s.ao_vivo);

  return ui.bloco(cfg.COR.primaria,
    ui.titulo(`${emo.streamer} STREAMERS DO SERVIDOR`),
    ui.divisor(),
    aoVivo.length ? ui.txt(`🔴 **Ao vivo agora:**\n${aoVivo.map((s) => `<@${s.user_id}>${s.link ? ` — [assistir](${s.link})` : ''}`).join('\n')}`) : null,
    offline.length ? ui.txt(`⚫ **Cadastrados:**\n${offline.map((s) => `<@${s.user_id}>`).join('\n')}`) : null,
    !ativos.length ? ui.txt('_Nenhum streamer cadastrado ainda._') : null,
  );
}

/** Publica ou reescreve o painel individual do streamer no canal configurado. */
async function publicarPainel(client, guildId, userId) {
  const streamer = getStreamer(guildId, userId);
  if (!streamer) return null;

  const canal = await gc.channel(client, guildId, 'canal_streamers');
  if (!canal) return null;

  const filaAtiva = temFilaAtiva(guildId, userId);

  try {
    if (streamer.mensagem_id) {
      const msg = await canal.messages.fetch(streamer.mensagem_id);
      await msg.edit(ui.msg(painelStreamer(streamer, { filaAtiva })));
      return msg;
    }
  } catch { /* mensagem apagada: publica de novo */ }

  const nova = await canal.send(ui.msg(painelStreamer(streamer, { filaAtiva })));
  registrarMensagem(guildId, userId, canal.id, nova.id);
  return nova;
}

/* ---------------------------------------------------------------- MODAIS */

function modalAoVivo(userId) {
  return new ModalBuilder().setCustomId(`streamer:aovivo_modal:${userId}`).setTitle('Ficar ao vivo')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('link').setLabel('Link da live')
          .setPlaceholder('https://twitch.tv/seu_canal').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('titulo').setLabel('Título/jogo da live (opcional)')
          .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100)),
    );
}

function modalAbrirFila(userId) {
  return new ModalBuilder().setCustomId(`streamer:abrirfila_modal:${userId}`).setTitle('Abrir fila de desafio')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('valor').setLabel('Valor da aposta por partida')
          .setPlaceholder('Ex: 20 ou 20,00').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(12)),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('gelo').setLabel('Modo (normal ou infinito)')
          .setPlaceholder('normal').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(10)),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('limite').setLabel('Quantas partidas você quer jogar')
          .setPlaceholder('Vazio = sem limite').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(3)),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('regras').setLabel('Regras da sua fila (opcional)')
          .setPlaceholder('Ex: só 1x1, sem revanche...').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)),
    );
}

/* --------------------------------------------------------- ACOES (BOTOES) */

const erro = (titulo, texto) => ui.msg(ui.bloco(cfg.COR.erro, ui.titulo(`❌ ${titulo}`), ui.txt(texto)), { efemero: true });

async function processarAoVivo(interaction, userId) {
  const link = interaction.fields.getTextInputValue('link').trim();
  const titulo = interaction.fields.getTextInputValue('titulo')?.trim() || null;

  setStatus(interaction.guildId, userId, true, { link, titulo });
  await publicarPainel(interaction.client, interaction.guildId, userId).catch(() => {});

  return interaction.reply(ui.msg(ui.bloco(cfg.COR.erro,
    ui.titulo('🔴 VOCÊ ESTÁ AO VIVO'),
    ui.txt('Seu painel foi atualizado.'),
    ui.nota('Clique em "ABRIR FILA DE DESAFIO" no seu painel pra deixar a galera te desafiar.'),
  ), { efemero: true }));
}

async function acaoOffline(interaction, userId) {
  setStatus(interaction.guildId, userId, false);
  await publicarPainel(interaction.client, interaction.guildId, userId).catch(() => {});

  const filaStreamer = require('./filaStreamer');
  const fechou = await filaStreamer.fechar(interaction.client, interaction.guildId, userId).catch(() => null);

  return interaction.reply(ui.msg(ui.bloco(cfg.COR.neutro,
    ui.titulo('⚫ VOCÊ FICOU OFFLINE'),
    ui.txt(fechou ? 'Sua fila exclusiva foi fechada e o valor travado devolvido.' : 'Boa live!'),
  ), { efemero: true }));
}

async function processarAbrirFila(interaction, userId) {
  const streamer = getStreamer(interaction.guildId, userId);
  if (!streamer?.ao_vivo) {
    return interaction.reply(erro('Você não está AO VIVO', 'Clique em "FICAR AO VIVO" antes de abrir a fila de desafio.'));
  }
  if (temFilaAtiva(interaction.guildId, userId)) {
    return interaction.reply(erro('Você já tem uma fila aberta', 'Feche a fila atual antes de abrir outra.'));
  }

  const valor = money.parse(interaction.fields.getTextInputValue('valor'));
  if (valor === null || valor <= 0) return interaction.reply(erro('Valor inválido', 'Use `20` ou `20,00`.'));
  if (valor * 2 <= cfg.taxaPartida) {
    return interaction.reply(erro('Valor baixo demais', `O prêmio precisa cobrir a taxa da organização (${money.fmt(cfg.taxaPartida)}).`));
  }

  const geloTexto = (interaction.fields.getTextInputValue('gelo') || 'normal').trim().toUpperCase();
  const gelo = geloTexto.startsWith('INF') ? 'INFINITO' : 'NORMAL';

  const limiteTexto = interaction.fields.getTextInputValue('limite')?.trim();
  let limite = null;
  if (limiteTexto) {
    const n = parseInt(limiteTexto, 10);
    if (!Number.isInteger(n) || n < 1) return interaction.reply(erro('Limite inválido', 'Use um número inteiro maior que zero, ou deixe vazio.'));
    limite = n;
  }

  const regras = interaction.fields.getTextInputValue('regras')?.trim() || null;

  const canal = await gc.channel(interaction.client, interaction.guildId, 'canal_streamers');
  if (!canal) {
    return interaction.reply(erro('Canal não configurado', 'Avise a staff: falta configurar `canal_streamers` com `/config canal`.'));
  }

  await interaction.deferReply({ flags: ui.EFEMERO });

  const filaStreamer = require('./filaStreamer');
  let r;
  try {
    r = await filaStreamer.abrir(interaction.client, interaction.guildId, userId, canal, { valor, gelo, limite, regras });
  } catch (e) {
    console.error('[streamer] falha ao abrir fila:', e.message);
    return interaction.editReply(ui.msg(ui.bloco(cfg.COR.erro,
      ui.titulo('❌ NÃO CONSEGUI ABRIR O TÓPICO'),
      ui.txt('Confira se o bot tem permissão de **Criar Tópicos** no canal de streamers.'),
    )));
  }

  await publicarPainel(interaction.client, interaction.guildId, userId).catch(() => {});

  return interaction.editReply(ui.msg(ui.bloco(cfg.COR.sucesso,
    ui.titulo('🔴 FILA DE DESAFIO ABERTA'),
    ui.divisor(),
    ui.tabela([
      ['Tópico', `<#${r.thread.id}>`],
      ['Aposta por partida', money.fmt(valor)],
      ['Modo', gelo === 'INFINITO' ? 'Gelo Infinito' : 'Gelo Normal'],
      ['Limite de partidas', limite ? String(limite) : 'sem limite'],
    ]),
    ui.nota(r.entrou.pago
      ? 'Valor já travado no seu saldo. Aguardando o primeiro desafiante.'
      : `Saldo insuficiente pra travar agora — a primeira partida será paga no ticket (faltam ${money.fmt(r.entrou.falta)}).`),
  )));
}

async function acaoFecharFila(interaction, userId) {
  const filaStreamer = require('./filaStreamer');
  const fechou = await filaStreamer.fechar(interaction.client, interaction.guildId, userId);
  if (!fechou) return interaction.reply(erro('Nenhuma fila aberta', 'Você não tem uma fila exclusiva ativa agora.'));

  await publicarPainel(interaction.client, interaction.guildId, userId).catch(() => {});

  return interaction.reply(ui.msg(ui.bloco(cfg.COR.neutro,
    ui.titulo('🔒 FILA FECHADA'),
    ui.txt('O tópico foi arquivado e o valor travado foi devolvido.'),
  ), { efemero: true }));
}

module.exports = {
  getStreamer, listarAtivos, temFilaAtiva, registrar, remover, setStatus, registrarMensagem,
  painelStreamer, painelListagem, publicarPainel,
  modalAoVivo, modalAbrirFila, processarAoVivo, acaoOffline, processarAbrirFila, acaoFecharFila,
};
