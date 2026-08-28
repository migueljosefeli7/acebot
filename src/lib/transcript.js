const { AttachmentBuilder } = require('discord.js');
const db = require('../db/database');

/**
 * Puxa o texto de uma mensagem, tanto do content antigo quanto dos
 * Components V2 (onde o texto real mora dentro de TextDisplay/Container),
 * andando recursivamente por qualquer objeto que carregue um `.content`.
 */
function textoDaMensagem(msg) {
  const partes = [];
  if (msg.content) partes.push(msg.content);

  const coletar = (obj) => {
    if (!obj) return;
    if (Array.isArray(obj)) return obj.forEach(coletar);
    if (typeof obj !== 'object') return;
    if (typeof obj.content === 'string' && obj.content.trim()) partes.push(obj.content);
    if (obj.components) coletar(obj.components);
    if (obj.data) coletar(obj.data);
  };

  for (const c of msg.components || []) coletar(typeof c.toJSON === 'function' ? c.toJSON() : c);

  for (const embed of msg.embeds || []) {
    if (embed.title) partes.push(embed.title);
    if (embed.description) partes.push(embed.description);
    for (const f of embed.fields || []) partes.push(`${f.name}: ${f.value}`);
  }

  return partes.join('\n').trim();
}

/**
 * Baixa todo o histórico da thread (paginado, até 1000 mensagens) e guarda
 * como prova — usado tanto para partidas (disputas) quanto depósitos
 * (contestação de chargeback).
 */
async function capturar(client, threadId, tipo, refId, guildId) {
  const thread = await client.channels.fetch(threadId).catch(() => null);
  if (!thread) return null;

  let mensagens = [];
  let before;
  for (let i = 0; i < 10; i++) {
    const lote = await thread.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!lote || !lote.size) break;
    mensagens.push(...lote.values());
    before = lote.last().id;
    if (lote.size < 100) break;
  }
  mensagens.reverse();

  const dados = mensagens.map((m) => ({
    autorId: m.author.id,
    autor: m.author.tag,
    bot: m.author.bot,
    criadoEm: m.createdTimestamp,
    texto: textoDaMensagem(m),
    anexos: [...m.attachments.values()].map((a) => a.url),
  }));

  const info = db.prepare(
    `INSERT INTO transcripts (guild_id, tipo, ref_id, thread_id, conteudo, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(guildId, tipo, String(refId), threadId, JSON.stringify(dados), Date.now());

  return info.lastInsertRowid;
}

const getTranscript = (id) => db.prepare('SELECT * FROM transcripts WHERE id = ?').get(id);

const ultimoPorRef = (tipo, refId) => db.prepare(
  'SELECT * FROM transcripts WHERE tipo = ? AND ref_id = ? ORDER BY id DESC LIMIT 1'
).get(tipo, String(refId));

const dataFmt = (ts) => new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

function gerarTXT(transcript) {
  const dados = JSON.parse(transcript.conteudo);
  const linhas = [
    `TRANSCRIPT ${transcript.tipo} #${transcript.ref_id}`,
    `Servidor: ${transcript.guild_id}  ·  Gerado em: ${dataFmt(transcript.created_at)}`,
    '='.repeat(60),
    '',
  ];
  for (const m of dados) {
    linhas.push(`[${dataFmt(m.criadoEm)}] ${m.autor}${m.bot ? ' (bot)' : ''}:`);
    if (m.texto) linhas.push(m.texto);
    for (const url of m.anexos) linhas.push(`  [anexo] ${url}`);
    linhas.push('');
  }
  return linhas.join('\n');
}

function escapeHtml(s = '') {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function gerarHTML(transcript) {
  const dados = JSON.parse(transcript.conteudo);
  const mensagensHtml = dados.map((m) => `
    <div class="msg${m.bot ? ' bot' : ''}">
      <div class="cabecalho">
        <span class="autor">${escapeHtml(m.autor)}</span>
        <span class="hora">${dataFmt(m.criadoEm)}</span>
      </div>
      ${m.texto ? `<div class="texto">${escapeHtml(m.texto).replace(/\n/g, '<br>')}</div>` : ''}
      ${m.anexos.map((a) => `<div class="anexo"><a href="${a}" target="_blank">📎 anexo</a></div>`).join('')}
    </div>`).join('\n');

  return `<!doctype html>
<html lang="pt-br"><head><meta charset="utf-8">
<title>Transcript ${transcript.tipo} #${transcript.ref_id}</title>
<style>
  body { background:#1e1f22; color:#dbdee1; font-family: 'gg sans', Arial, sans-serif; margin:0; padding:24px; }
  h1 { color:#fff; font-size:20px; }
  .meta { color:#949ba4; font-size:13px; margin-bottom:20px; }
  .msg { background:#2b2d31; border-radius:8px; padding:10px 14px; margin-bottom:8px; }
  .msg.bot { border-left:3px solid #ff0101; }
  .cabecalho { display:flex; justify-content:space-between; margin-bottom:4px; }
  .autor { font-weight:600; color:#fff; }
  .hora { color:#949ba4; font-size:12px; }
  .texto { white-space:pre-wrap; line-height:1.4; }
  .anexo a { color:#00a8fc; text-decoration:none; }
</style></head>
<body>
  <h1>Transcript ${transcript.tipo} #${transcript.ref_id}</h1>
  <div class="meta">Servidor ${transcript.guild_id} · Gerado em ${dataFmt(transcript.created_at)} · ${dados.length} mensagem(ns)</div>
  ${mensagensHtml}
</body></html>`;
}

function anexos(transcript) {
  return [
    new AttachmentBuilder(Buffer.from(gerarTXT(transcript), 'utf8'), { name: `transcript-${transcript.tipo.toLowerCase()}-${transcript.ref_id}.txt` }),
    new AttachmentBuilder(Buffer.from(gerarHTML(transcript), 'utf8'), { name: `transcript-${transcript.tipo.toLowerCase()}-${transcript.ref_id}.html` }),
  ];
}

module.exports = { capturar, getTranscript, ultimoPorRef, gerarTXT, gerarHTML, anexos };
