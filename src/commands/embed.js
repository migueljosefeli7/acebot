const { SlashCommandBuilder, ChannelType, Routes } = require('discord.js');
const cfg = require('../config');
const ui = require('../lib/ui');
const gc = require('../lib/guildconfig');

const erro = (interaction, titulo, texto) => interaction.reply(ui.msg(
  ui.bloco(cfg.COR.erro, ui.titulo(`❌ ${titulo}`), ui.txt(texto)), { efemero: true },
));

const V2_FLAG = 1 << 15; // MessageFlags.IsComponentsV2

/**
 * Aceita o JSON cru — colado a mao ou exportado de discord-webhook.com/app —
 * e devolve o payload pronto pra API do Discord, nos dois formatos possiveis:
 * embed legado (`embeds: [...]`) ou Components V2 (`components: [...]`).
 */
function normalizar(bruto) {
  // discord-webhook.com/app exporta {"messages":[{"data": {...}}]}
  const payload = { ...(Array.isArray(bruto?.messages) && bruto.messages[0]?.data ? bruto.messages[0].data : bruto) };

  if (Array.isArray(payload.components) && payload.components.length) {
    // Components V2 exige a flag, e a API recusa content/embeds junto com components.
    payload.flags = (payload.flags || 0) | V2_FLAG;
    delete payload.content;
    delete payload.embeds;
  } else if (Array.isArray(payload.embeds)) {
    // Formato legado: aplica a cor oficial da ACE em quem nao trouxer cor propria.
    payload.embeds = payload.embeds.map((e) => ({ color: cfg.COR.primaria, ...e }));
  }

  return payload;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('[STAFF] Publica um embed customizado a partir de um JSON')
    .addChannelOption((o) => o.setName('canal').setDescription('Canal onde vai publicar').setRequired(true)
      .addChannelTypes(ChannelType.GuildText))
    .addStringOption((o) => o.setName('json').setDescription('Cole o JSON do embed aqui'))
    .addAttachmentOption((o) => o.setName('arquivo').setDescription('Ou anexe um arquivo .json')),

  async execute(interaction) {
    if (!gc.hasRole(interaction.member, 'cargo_staff')) {
      return erro(interaction, 'Sem permissão', 'Só a staff pode publicar embeds customizados.');
    }

    const canal = interaction.options.getChannel('canal');
    const jsonTexto = interaction.options.getString('json');
    const arquivo = interaction.options.getAttachment('arquivo');

    if (!jsonTexto && !arquivo) {
      return erro(interaction, 'Faltou o JSON', 'Cole o JSON na opção `json` ou anexe um arquivo `.json`.');
    }

    await interaction.deferReply({ flags: ui.EFEMERO });

    let bruto;
    try {
      let texto = jsonTexto;
      if (!texto) {
        const resp = await fetch(arquivo.url);
        texto = await resp.text();
      }
      bruto = JSON.parse(texto);
    } catch (e) {
      return interaction.editReply(ui.msg(ui.bloco(cfg.COR.erro,
        ui.titulo('❌ JSON INVÁLIDO'),
        ui.txt(`Não consegui interpretar o JSON: \`${e.message}\``),
      )));
    }

    let payload;
    try {
      payload = normalizar(bruto);
    } catch (e) {
      return interaction.editReply(ui.msg(ui.bloco(cfg.COR.erro,
        ui.titulo('❌ FORMATO NÃO RECONHECIDO'),
        ui.txt('Esperava um JSON com `embeds` (formato clássico) ou `components` (Components V2).'),
      )));
    }

    try {
      const msg = await interaction.client.rest.post(Routes.channelMessages(canal.id), { body: payload });

      return interaction.editReply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('✅ EMBED PUBLICADO'),
        ui.comBotao(
          `Publicado em ${canal}.`,
          ui.botaoLink(`https://discord.com/channels/${interaction.guildId}/${canal.id}/${msg.id}`, 'VER MENSAGEM', '🔗'),
        ),
      )));
    } catch (e) {
      console.error('[embed] falha ao publicar:', e);
      return interaction.editReply(ui.msg(ui.bloco(cfg.COR.erro,
        ui.titulo('❌ O DISCORD RECUSOU ESSE JSON'),
        ui.txt(`\`\`\`\n${String(e.message || 'erro desconhecido').slice(0, 900)}\n\`\`\``),
        ui.nota('Geralmente é um campo obrigatório faltando ou um valor fora do formato esperado pela API.'),
      )));
    }
  },
};
