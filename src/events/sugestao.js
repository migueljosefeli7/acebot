const { ThreadAutoArchiveDuration } = require('discord.js');

const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const gc = require('../lib/guildconfig');
const sugestao = require('../features/sugestao');

const EXT_IMAGEM = /\.(png|jpe?g|webp|gif|bmp)$/i;

module.exports = async function onSugestao(message) {
  try {
    if (message.author.bot || message.webhookId || !message.guildId || message.system) return;

    const canalId = gc.get(message.guildId, 'canal_sugestoes');
    if (!canalId || message.channelId !== canalId) return;

    const texto = message.content.trim();
    const attachments = [...message.attachments.values()].map((a) => ({
      nome: a.name || 'arquivo',
      url: a.url,
      imagem: !!(a.contentType?.startsWith('image/') || EXT_IMAGEM.test(a.name || '')),
    }));

    if (!texto && !attachments.length) return;

    const conteudo = texto || '_Sugestão enviada somente com anexo._';
    const info = db.prepare(
      `INSERT INTO suggestions (guild_id, channel_id, author_id, content, attachment_urls, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(message.guildId, message.channelId, message.author.id,
      conteudo.slice(0, 2800), JSON.stringify(attachments), Date.now());
    const id = Number(info.lastInsertRowid);

    let publicada;
    try {
      publicada = await message.channel.send({
        ...ui.msg(sugestao.painel(sugestao.get(id))),
        allowedMentions: { parse: [] },
      });
    } catch (e) {
      db.prepare('DELETE FROM suggestions WHERE id = ?').run(id);
      throw e;
    }

    db.prepare('UPDATE suggestions SET message_id = ? WHERE id = ?').run(publicada.id, id);

    try {
      const thread = await publicada.startThread({
        name: `💡 Sugestão #${id} · ${message.author.username}`.slice(0, 100),
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        reason: `Discussão da sugestão #${id}`,
      });
      db.prepare('UPDATE suggestions SET thread_id = ? WHERE id = ?').run(thread.id, id);

      await thread.send({
        ...ui.msg(ui.bloco(cfg.COR.neutro,
          ui.titulo(`💬 DISCUSSÃO DA SUGESTÃO #${id}`),
          ui.txt(`<@${message.author.id}>, explique melhor sua ideia aqui. Todos podem conversar com respeito.`),
          ui.nota('Os votos são feitos nos botões da mensagem principal.'),
        )),
        allowedMentions: { users: [message.author.id], parse: [] },
      });

      await publicada.edit({
        ...ui.msg(sugestao.painel(sugestao.get(id))),
        allowedMentions: { parse: [] },
      });
    } catch (e) {
      console.error(`[sugestao #${id}] não consegui criar o tópico:`, e.message);
    }

    await message.delete().catch((e) => {
      console.warn(`[sugestao #${id}] não consegui apagar a mensagem original:`, e.message);
    });
  } catch (e) {
    console.error('[sugestao] falha ao transformar mensagem:', e.message);
    await message.reply(ui.msg(ui.bloco(cfg.COR.erro,
      ui.titulo('❌ NÃO CONSEGUI CRIAR A SUGESTÃO'),
      ui.txt('Avise a staff para conferir minhas permissões neste canal.'),
    ))).catch(() => {});
  }
};
