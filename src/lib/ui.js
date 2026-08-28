const {
  ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder,
  MediaGalleryBuilder, MediaGalleryItemBuilder, ThumbnailBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  SeparatorSpacingSize, MessageFlags,
} = require('discord.js');

/**
 * Kit de UI do bot — Components V2.
 *
 * Regras do Components V2 que valem para TODAS as chamadas:
 *  - a flag IsComponentsV2 e obrigatoria;
 *  - a mensagem NAO pode ter `content` nem `embeds`, tudo vira componente;
 *  - editar uma mensagem V2 exige mandar a flag de novo;
 *  - teto de 4000 caracteres e 40 componentes por mensagem.
 */

const V2 = MessageFlags.IsComponentsV2;
const EFEMERO = MessageFlags.Ephemeral;

/** flags(true) => mensagem V2 privada; flags() => V2 publica. */
const flags = (efemero = false) => (efemero ? V2 | EFEMERO : V2);

/* ------------------------------------------------------------------ TEXTO */

const txt = (conteudo) => new TextDisplayBuilder().setContent(String(conteudo));

/** Titulo principal do bloco. */
const titulo = (t) => txt(`## ${t}`);

/** Subtitulo de seção dentro do bloco. */
const secao = (t) => txt(`### ${t}`);

/** Linha pequena e apagada — usada para rodape e observacao. */
const nota = (t) => txt(`-# ${t}`);

/* --------------------------------------------------------------- DIVISOR */

const divisor = (grande = false) => new SeparatorBuilder()
  .setDivider(true)
  .setSpacing(grande ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);

/** Espaco sem a linha, para respirar sem cortar o bloco. */
const espaco = (grande = false) => new SeparatorBuilder()
  .setDivider(false)
  .setSpacing(grande ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);

/* --------------------------------------------------------------- TABELA */

/**
 * Tabela alinhada com condutor de pontos. Vai dentro de bloco de codigo para
 * a fonte ser monoespacada e as colunas baterem em qualquer tela.
 *
 *   Valor por jogador ····· R$ 100,00
 *   Premio ao vencedor ···· R$ 199,50
 *
 * Emoji nao entra aqui: em monoespacado a largura dele varia e desalinha tudo.
 */
function tabela(pares, { largura = 34 } = {}) {
  const linhas = pares
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([rotulo, valor]) => {
      const r = String(rotulo);
      const v = String(valor);
      const pontos = Math.max(1, largura - r.length - v.length - 2);
      return `${r} ${'·'.repeat(pontos)} ${v}`;
    });
  return txt('```\n' + (linhas.join('\n') || '—') + '\n```');
}

/** Lista de itens em linha. Para menções, que não podem entrar em bloco de código. */
const lista = (itens) => txt(itens.length ? itens.map((i) => `• ${i}`).join('\n') : '_vazio_');

/* -------------------------------------------------------------- SECOES */

/** Texto com miniatura à direita (avatar, banner pequeno). */
const comThumb = (textos, url) => new SectionBuilder()
  .addTextDisplayComponents(...[].concat(textos).map(txt))
  .setThumbnailAccessory(new ThumbnailBuilder().setURL(url));

/** Texto com um botão à direita. */
const comBotao = (textos, botao) => new SectionBuilder()
  .addTextDisplayComponents(...[].concat(textos).map(txt))
  .setButtonAccessory(botao);

/** Imagem larga (banner do painel de fila, QR do PIX). */
const imagem = (...urls) => new MediaGalleryBuilder()
  .addItems(...urls.filter(Boolean).map((u) => new MediaGalleryItemBuilder().setURL(u)));

/* --------------------------------------------------------------- BOTOES */

const linhaBotoes = (...botoes) => new ActionRowBuilder().addComponents(...botoes.filter(Boolean));

const botao = (id, rotulo, { estilo = ButtonStyle.Secondary, emoji, off = false } = {}) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(rotulo).setStyle(estilo).setDisabled(off);
  if (emoji) b.setEmoji(emoji);
  return b;
};

const botaoLink = (url, rotulo, emoji) => {
  const b = new ButtonBuilder().setURL(url).setLabel(rotulo).setStyle(ButtonStyle.Link);
  if (emoji) b.setEmoji(emoji);
  return b;
};

const ESTILO = ButtonStyle;

/* ------------------------------------------------------------- CONTAINER */

/** Bloco com barra colorida na lateral. É a moldura de tudo no bot. */
function bloco(cor, ...partes) {
  const c = new ContainerBuilder().setAccentColor(cor);
  for (const parte of partes.flat().filter(Boolean)) {
    const tipo = parte.constructor.name;
    if (tipo === 'TextDisplayBuilder') c.addTextDisplayComponents(parte);
    else if (tipo === 'SectionBuilder') c.addSectionComponents(parte);
    else if (tipo === 'SeparatorBuilder') c.addSeparatorComponents(parte);
    else if (tipo === 'MediaGalleryBuilder') c.addMediaGalleryComponents(parte);
    else if (tipo === 'ActionRowBuilder') c.addActionRowComponents(parte);
    else if (tipo === 'FileBuilder') c.addFileComponents(parte);
    else throw new Error(`ui.bloco: componente não suportado (${tipo})`);
  }
  return c;
}

/** Atalho: monta a mensagem V2 pronta para reply/send/edit. */
const msg = (componentes, { efemero = false, files } = {}) => ({
  flags: flags(efemero),
  components: [].concat(componentes),
  ...(files ? { files } : {}),
});

module.exports = {
  V2, EFEMERO, flags, msg,
  txt, titulo, secao, nota, divisor, espaco, tabela, lista,
  comThumb, comBotao, imagem,
  linhaBotoes, botao, botaoLink, ESTILO, bloco,
};
