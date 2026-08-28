const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');

const get = (id) => db.prepare('SELECT * FROM suggestions WHERE id = ?').get(id);

function contagem(id) {
  const rows = db.prepare(
    'SELECT vote, COUNT(*) total FROM suggestion_votes WHERE suggestion_id = ? GROUP BY vote'
  ).all(id);
  const votos = { SIM: 0, NAO: 0 };
  for (const row of rows) votos[row.vote] = row.total;
  return votos;
}

function anexos(s) {
  try { return JSON.parse(s.attachment_urls || '[]'); } catch { return []; }
}

function painel(s) {
  const votos = contagem(s.id);
  const imagens = anexos(s).filter((a) => a.imagem).map((a) => a.url).slice(0, 4);
  const arquivos = anexos(s).filter((a) => !a.imagem)
    .map((a) => `[${a.nome || 'arquivo'}](${a.url})`).slice(0, 5);

  return ui.bloco(cfg.COR.primaria,
    ui.titulo(`💡 SUGESTÃO #${s.id}`),
    ui.nota(`Enviada por <@${s.author_id}> · <t:${Math.floor(s.created_at / 1000)}:R>`),
    ui.divisor(),
    ui.txt(s.content.slice(0, 2800)),
    imagens.length ? ui.imagem(...imagens) : null,
    arquivos.length ? ui.txt(`**Anexos:** ${arquivos.join(' · ')}`) : null,
    ui.divisor(),
    ui.secao('🗳️ Vote na ideia'),
    ui.linhaBotoes(
      ui.botao(`suggestion:vote:${s.id}:SIM`, `SIM · ${votos.SIM}`, {
        estilo: ui.ESTILO.Success, emoji: '✅', off: s.status !== 'ABERTA',
      }),
      ui.botao(`suggestion:vote:${s.id}:NAO`, `NÃO · ${votos.NAO}`, {
        estilo: ui.ESTILO.Danger, emoji: '❌', off: s.status !== 'ABERTA',
      }),
      s.thread_id
        ? ui.botaoLink(`https://discord.com/channels/${s.guild_id}/${s.thread_id}`, 'DISCUTIR', '💬')
        : null,
    ),
    ui.nota('Seu voto é único. Clique na outra opção para trocar ou na mesma para remover.'),
  );
}

/** Um voto por pessoa. Clicar no mesmo voto remove; clicar no outro troca. */
const votar = db.transaction((suggestionId, userId, vote) => {
  const s = get(suggestionId);
  if (!s) return { erro: 'NAO_EXISTE' };
  if (s.status !== 'ABERTA') return { erro: 'FECHADA' };
  if (!['SIM', 'NAO'].includes(vote)) return { erro: 'VOTO_INVALIDO' };

  const atual = db.prepare(
    'SELECT vote FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?'
  ).get(suggestionId, userId);

  if (atual?.vote === vote) {
    db.prepare('DELETE FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?')
      .run(suggestionId, userId);
    return { ok: true, acao: 'REMOVIDO', suggestion: s };
  }

  db.prepare(
    `INSERT INTO suggestion_votes (suggestion_id, user_id, vote, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(suggestion_id, user_id) DO UPDATE SET vote = excluded.vote, created_at = excluded.created_at`
  ).run(suggestionId, userId, vote, Date.now());
  return { ok: true, acao: atual ? 'TROCADO' : 'REGISTRADO', suggestion: s };
});

async function processarVoto(interaction, suggestionId, vote) {
  const s = get(suggestionId);
  if (!s || s.guild_id !== interaction.guildId || s.message_id !== interaction.message.id) {
    return interaction.reply(ui.msg(ui.bloco(cfg.COR.erro,
      ui.titulo('❌ SUGESTÃO NÃO ENCONTRADA'),
      ui.txt('Essa votação não corresponde a uma sugestão válida.'),
    ), { efemero: true }));
  }

  const r = votar(suggestionId, interaction.user.id, vote);
  if (r.erro) {
    return interaction.reply(ui.msg(ui.bloco(cfg.COR.erro,
      ui.titulo('❌ VOTAÇÃO ENCERRADA'),
      ui.txt('Não é mais possível votar nessa sugestão.'),
    ), { efemero: true }));
  }

  await interaction.update({
    ...ui.msg(painel(get(suggestionId))),
    allowedMentions: { parse: [] },
  });
}

module.exports = { get, contagem, painel, votar, processarVoto };
