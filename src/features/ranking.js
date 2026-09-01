const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const gc = require('../lib/guildconfig');
const membros = require('../lib/membros');
const elo = require('./elo');

const MEDALHAS = ['🥇', '🥈', '🥉'];
const CARGOS_TOPO = ['cargo_top1', 'cargo_top2', 'cargo_top3'];

/** Top N do servidor. Desempate: mais vitórias, depois quem chegou primeiro. */
const top = (limite = 10) => db.prepare(
  `SELECT * FROM users WHERE pontos > 0 AND banned = 0
   ORDER BY pontos DESC, wins DESC, created_at ASC LIMIT ?`
).all(limite);

/* --------------------------------------------------------- RANKING POR PERIODO */

const JANELA_MS = {
  diario: 24 * 60 * 60 * 1000,
  semanal: 7 * 24 * 60 * 60 * 1000,
  mensal: 30 * 24 * 60 * 60 * 1000,
};
const TITULO_PERIODO = { diario: '📅 Ranking do Dia', semanal: '🗓️ Ranking da Semana', mensal: '📆 Ranking do Mês' };

/**
 * Top por VITORIAS dentro da janela (diario = ultimas 24h, semanal = ultimos
 * 7 dias, mensal = ultimos 30 dias — janela rolante, nao calendario fixo).
 */
const topPeriodo = (guildId, periodo, limite = 10) => db.prepare(
  `SELECT winner_id AS discord_id, COUNT(*) AS vitorias
   FROM matches
   WHERE guild_id = ? AND status = 'FINALIZADA' AND finished_at >= ?
   GROUP BY winner_id ORDER BY vitorias DESC LIMIT ?`
).all(guildId, Date.now() - JANELA_MS[periodo], limite);

function painelPeriodo(guildId, periodo) {
  const lista = topPeriodo(guildId, periodo);
  const linhas = lista.map((u, i) => {
    const medalha = MEDALHAS[i] || `\`#${String(i + 1).padStart(2, ' ')}\``;
    return `${medalha} <@${u.discord_id}> — **${u.vitorias}** vitória(s)`;
  });

  return ui.bloco(cfg.COR.primaria,
    ui.titulo(TITULO_PERIODO[periodo]),
    ui.nota(`Top ${lista.length || 0} por vitórias`),
    ui.divisor(),
    lista.length ? ui.txt(linhas.join('\n')) : ui.txt('_Ninguém venceu partidas nesse período ainda._'),
  );
}

/**
 * Roda no boot e periodicamente: posta o ranking do dia/semana/mes quando a
 * janela vira, sem precisar de lib de cron. O "ultima vez que postou" fica
 * guardado na propria tabela de config do servidor.
 */
async function postarAutomatico(client, guildId) {
  const canal = await gc.channel(client, guildId, 'canal_ranking');
  if (!canal) return;

  const agora = Date.now();
  for (const periodo of ['diario', 'semanal', 'mensal']) {
    const chave = `ranking_ultimo_${periodo}`;
    const ultimo = Number(gc.get(guildId, chave) || 0);
    if (agora - ultimo < JANELA_MS[periodo]) continue;

    await canal.send(ui.msg(painelPeriodo(guildId, periodo))).catch((e) =>
      console.error(`[ranking] falha ao postar ranking ${periodo}:`, e.message));
    gc.set(guildId, chave, String(agora));
  }
}

/* ---------------------------------------------------------------- PAINEL */

function painel(guildId) {
  const lista = top(10);

  const linhas = lista.map((u, i) => {
    const e = elo.eloDe(u.pontos);
    const medalha = MEDALHAS[i] || `\`#${String(i + 1).padStart(2, ' ')}\``;
    return `${medalha} <@${u.discord_id}> — ${e.emoji} **${e.nome}** · \`${u.pontos} pts\`\n` +
      `└ ${u.wins}V / ${u.losses}D`;
  });

  const totalJogadores = db.prepare('SELECT COUNT(*) c FROM users WHERE pontos > 0').get().c;

  return ui.bloco(cfg.COR.primaria,
    ui.titulo('🏆 RANKING · TOP 10'),
    ui.nota(`${totalJogadores} jogador(es) pontuando · atualizado <t:${Math.floor(Date.now() / 1000)}:R>`),
    ui.divisor(),
    lista.length
      ? ui.txt(linhas.join('\n'))
      : ui.txt('_Ninguém pontuou ainda. Vença uma partida para entrar no ranking._'),
    ui.divisor(),
    ui.txt(
      `${MEDALHAS[0]} **Top 1**, ${MEDALHAS[1]} **Top 2** e ${MEDALHAS[2]} **Top 3** ganham cargos exclusivos.\n` +
      'Perdeu a posição, perde o cargo na hora.'
    ),
    ui.linhaBotoes(
      ui.botao('rank:meu', 'MEU ELO', { estilo: ui.ESTILO.Primary, emoji: '🎖️' }),
      ui.botao('rank:atualizar', 'ATUALIZAR', { emoji: '🔄' }),
    ),
  );
}

/** Reescreve (ou publica) a mensagem fixa do ranking. */
async function atualizarPainel(client, guildId) {
  const canal = await gc.channel(client, guildId, 'canal_ranking');
  if (!canal) return;

  const msgId = gc.get(guildId, 'mensagem_ranking');
  try {
    if (msgId) {
      const msg = await canal.messages.fetch(msgId);
      await msg.edit(ui.msg(painel(guildId)));
      return;
    }
  } catch { /* mensagem apagada: publica de novo */ }

  const nova = await canal.send(ui.msg(painel(guildId)));
  gc.set(guildId, 'mensagem_ranking', nova.id);
}

/* ------------------------------------------------------- CARGOS DO TOPO */

/**
 * Garante que só o dono atual de cada posição tenha o cargo dela.
 * Chamado sempre que a pontuação de alguém muda.
 */
async function sincronizarCargosTopo(client, guildId) {
  const cargos = CARGOS_TOPO.map((k) => gc.get(guildId, k));
  if (!cargos.some(Boolean)) return { ok: false, motivo: 'SEM_CARGOS' };

  // Usa o cache compartilhado: baixar a lista inteira de membros aqui custava
  // uma chamada gigante a CADA partida finalizada.
  const guild = await membros.comMembros(client, guildId);
  if (!guild) return { ok: false, motivo: 'GUILD_INACESSIVEL' };

  const podio = top(3).map((u) => u.discord_id);
  const mudou = [];

  for (let i = 0; i < 3; i++) {
    const roleId = cargos[i];
    if (!roleId) continue;

    const dono = podio[i] || null;
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) continue;

    // Tira de quem não é mais o dono da posição.
    for (const membro of role.members.values()) {
      if (membro.id === dono) continue;
      try {
        await membro.roles.remove(roleId, `Perdeu o Top ${i + 1}`);
        mudou.push({ userId: membro.id, posicao: i + 1, acao: 'perdeu' });
      } catch (e) {
        console.error(`[ranking] não consegui remover o Top ${i + 1} de ${membro.id}: ${e.message}`);
      }
    }

    // Dá para o dono atual.
    if (dono && !role.members.has(dono)) {
      try {
        const membro = await guild.members.fetch(dono);
        await membro.roles.add(roleId, `Assumiu o Top ${i + 1}`);
        mudou.push({ userId: dono, posicao: i + 1, acao: 'ganhou' });
      } catch (e) {
        console.error(`[ranking] não consegui dar o Top ${i + 1} a ${dono}: ${e.message}\n` +
          '   O cargo do bot precisa estar ACIMA dos cargos de topo.');
      }
    }
  }

  return { ok: true, mudou };
}

/** Rotina completa após uma partida: cargos do topo + painel. */
async function atualizarTudo(client, guildId) {
  // A mudança de pódio já fica visível no próprio embed do ranking (atualizarPainel)
  // — não manda mais uma mensagem de log separada pra isso.
  await sincronizarCargosTopo(client, guildId);
  await atualizarPainel(client, guildId);
}

module.exports = {
  top, painel, atualizarPainel, sincronizarCargosTopo, atualizarTudo, MEDALHAS, CARGOS_TOPO,
  topPeriodo, painelPeriodo, postarAutomatico, JANELA_MS,
};
