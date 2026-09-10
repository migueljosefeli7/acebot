const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown } = require('discord.js');
const db = require('../db/database');
const api = require('../lib/nixSalas');
const cfg = require('../config');
const gc = require('../lib/guildconfig');
const active = new Set();
const rosters = new Map();
const published = new Map();
const publishing = new Set();
const pollMs = Math.max(15000, Number(process.env.NIX_POLL_SECONDS || 15) * 1000 || 15000);
let nextQueryAt = 0;
let sweeping = false;
let blockedUntil = 0;
const clean = (v) => escapeMarkdown(String(v ?? '—')).replace(/@/g, '@\u200b').slice(0, 80);
const match = (id) => require('./partida').get(id);
const row = (...buttons) => new ActionRowBuilder().addComponents(buttons);
const button = (id, label, style, disabled = false) => new ButtonBuilder()
  .setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const timestamp = (value) => {
  if (!value) return '—';
  const millis = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
  return Number.isFinite(millis) ? `<t:${Math.floor(millis / 1000)}:F>` : clean(value);
};
const playerLine = (p) => `• ${p.platform === 'mobile' ? '📱' : p.platform === 'emulator' ? '🖥️' : '❔'} **#${clean(p.slot)} ${clean(p.nickname)}** \`${clean(p.player_uid ?? p.account_id)}\``;
function rosterFields(members) {
  const players = (members || []).filter(p => !p.is_owner).slice(0, 8)
    .sort((a, b) => Number(a.slot) - Number(b.slot));
  return [1, 2].map(team => {
    const list = players.filter(p => Number(p.team) === team);
    return { name: `Time ${team}`, value: list.length ? list.map(playerLine).join('\n') : 'Nenhum jogador' };
  });
}

function painel(m, members, icon) {
  const waiting = m.status === 'SALA_CRIADA';
  const players = (members || []).filter(p => !p.is_owner).slice(0, 8)
    .sort((a, b) => Number(a.slot) - Number(b.slot));
  const teams = rosterFields(players).map(team => `**${team.name}**\n${team.value}`);
  const unknown = players.filter(p => ![1, 2].includes(Number(p.team)));
  if (unknown.length) teams.push('**Time não informado**\n' + unknown.map(playerLine).join('\n'));
  const list = members == null ? 'Consultando jogadores…' : teams.join('\n');
  const delay = api.configuracaoDaSala(m).start_delay_minutes;
  const deadline = Math.floor((m.sala_pronta_em + delay * 60000) / 1000);
  const mode = api.configuracaoDaSala(m).config_type;
  const embed = new EmbedBuilder().setColor(0xff0101).setTitle('Painel da Sala')
    .setDescription('Sala criada com sucesso!')
    .addFields(
      { name: 'ⓘ Informações da Sala', value:
        `• **ID da Sala:** \`${m.nix_room_id}\`\n• **Senha:** \`${m.nix_room_password}\`\n• **Status:** ${m.nix_result_json ? 'Partida finalizada' : waiting ? 'Aguardando' : m.status === 'EM_ANDAMENTO' ? 'Em andamento' : clean(m.status)}\n• **Início Automático:** ${waiting ? '<t:' + deadline + ':R>' : '—'}` },
      { name: `👥 Jogadores na Sala (${players.length}/8)`, value: list.slice(0, 1024) },
      { name: 'Gerenciar sala', value: 'Use os botões abaixo. Quando estiverem prontos, os dois podem digitar **+go**.' }
    ).setFooter({ text: `Modo: ${{ap_padrao: 'AP Padrão', gelo_inf: 'Gelo Infinito', tatico: 'Tático'}[mode]} · Partida #${m.id}` });
  if (icon) embed.setThumbnail(icon);
  const components = [
    row(button(`match:room:${m.id}`, 'Iniciar', ButtonStyle.Success, !waiting),
      button(`match:nix_refresh:${m.id}`, 'Atualizar', ButtonStyle.Primary, !waiting)),
    row(button(`match:nix_copy:${m.id}`, 'Copiar ID e Senha', ButtonStyle.Secondary)),
  ];
  if (m.nix_invite_link && /^https:\/\/ffshare\.garena\.com\//.test(m.nix_invite_link)) {
    components[1].addComponents(new ButtonBuilder().setLabel('Link da Sala').setStyle(ButtonStyle.Link).setURL(m.nix_invite_link));
  }
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

function inicioEmbed(m, members, icon, automatico = true) {
  const embed = new EmbedBuilder().setColor(0xff0101).setTitle('🚀 Sala iniciada com sucesso!')
    .setDescription(`A sala foi iniciada de forma ${automatico ? 'automática' : 'manual'}.\nIniciada em ${timestamp(m.em_andamento_em || Date.now())}`)
    .addFields(rosterFields(members))
    .addFields({ name: '🔄 Recriar sala', value: 'Quem clicar em **Recriar sala** pagará **R$ 0,50**. A sala atual será ignorada e uma nova será criada automaticamente.' })
    .setFooter({ text: `Sala ${m.nix_room_id} · Partida #${m.id}` });
  if (icon) embed.setThumbnail(icon);
  return {
    embeds: [embed],
    components: [row(button(`match:recriar:${m.id}`, 'Recriar sala · R$ 0,50', ButtonStyle.Primary))],
    allowedMentions: { parse: [] },
  };
}

async function publicarInicio(client, id, automatico = true) {
  const m = match(id);
  if (!m?.thread_id) return null;
  const channel = await client.channels.fetch(m.thread_id);
  return channel.send(inicioEmbed(m, rosters.get(m.nix_session_id) || [], client.user.displayAvatarURL(), automatico));
}

async function publicar(client, id, members = null) {
  const m = match(id);
  if (!m?.nix_session_id || !m.thread_id) return;
  if (members != null) rosters.set(m.nix_session_id, members);
  else members = rosters.get(m.nix_session_id) || null;
  const payload = painel(m, members, client.user.displayAvatarURL());
  const fingerprint = JSON.stringify(payload);
  const key = m.nix_session_id;
  if (publishing.has(key)) return;
  if (m.nix_panel_id && published.get(key) === fingerprint) return;
  publishing.add(key);
  try {
    const thread = await client.channels.fetch(m.thread_id);
    if (m.nix_panel_id) {
      try {
        await thread.messages.edit(m.nix_panel_id, payload);
        published.set(key, fingerprint);
        return;
      } catch (e) { if (e.code !== 10008) throw e; }
    }
    const message = await thread.send(payload);
    db.prepare('UPDATE matches SET nix_panel_id = ? WHERE id = ?').run(message.id, id);
    published.set(key, fingerprint);
  } finally { publishing.delete(key); }
}

const firstStat = (source, keys) => {
  for (const key of keys) if (source?.[key] != null) return source[key];
  return '—';
};
function roundsDoTime(data, team) {
  const teamData = (data.teams || []).find(t => Number(t.team) === team) || {};
  const direct = firstStat(teamData, ['rounds_won', 'round_wins', 'rounds', 'score']);
  if (direct !== '—' && typeof direct !== 'object') return direct;
  for (const source of [data.rounds, data.round_score, data.score, data.team_scores]) {
    if (Array.isArray(source)) {
      const found = source.find(item => Number(item?.team) === team);
      if (found) return firstStat(found, ['rounds_won', 'round_wins', 'rounds', 'score', 'wins']);
      if (source[team - 1] != null && typeof source[team - 1] !== 'object') return source[team - 1];
    } else if (source && typeof source === 'object') {
      const value = source[team] ?? source[`team_${team}`] ?? source[`team${team}`];
      if (value != null) return typeof value === 'object'
        ? firstStat(value, ['rounds_won', 'round_wins', 'rounds', 'score', 'wins']) : value;
    }
  }
  return '—';
}
const statsLine = (p) =>
  `\`KILL ${String(firstStat(p, ['kills', 'kill'])).padStart(3)}\`  ` +
  `\`DEAD ${String(firstStat(p, ['deaths', 'dead', 'deads'])).padStart(3)}\`  ` +
  `\`HS ${String(firstStat(p, ['headshots', 'hs'])).padStart(3)}\`  ` +
  `\`DANO ${String(firstStat(p, ['damage', 'damage_dealt', 'dano'])).padStart(4)}\``;

function resultadoEmbed(m, data) {
  const round1 = roundsDoTime(data, 1);
  const round2 = roundsDoTime(data, 2);
  const vencedor = data.winner_team == null ? 'Vencedor não identificado' : `Time ${clean(data.winner_team)} venceu`;
  const embed = new EmbedBuilder().setColor(0xff0101).setTitle('🏆 Resultado da Partida')
    .setDescription(
      `## ${vencedor} 🏆\n` +
      `### Placar por rounds\n🔵 **Time 1  ${clean(round1)}  ×  ${clean(round2)}  Time 2** 🔴`
    );
  for (const team of (data.teams || []).slice(0, 2)) {
    embed.addFields({ name: `Time ${clean(team.team)}${team.is_winner ? ' 🏆' : ''}`, value:
      (team.players || []).slice(0, 4).map(p =>
        `${String(data.match_mvp?.account_id) === String(p.account_id) ? '⭐ ' : ''}**${clean(p.nickname)}**\n${statsLine(p)}`
      ).join('\n\n').slice(0, 1024) || 'Sem dados' });
  }
  if (data.match_mvp) embed.addFields({ name: '⭐ MVP da partida',
    value: `**${clean(data.match_mvp.nickname)}** · Time ${clean(data.match_mvp.team)} · **${firstStat(data.match_mvp, ['kills', 'kill'])} KILL**` });
  embed.setFooter({ text: `Partida #${m.id} · confirme o vencedor abaixo.` });
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

async function atualizar(client, id) {
  if (active.has(id) || Date.now() < blockedUntil || Date.now() < nextQueryAt) return false;
  let m = match(id);
  if (!m?.nix_session_id || m.nix_poll_done || Date.now() < m.nix_poll_at) return false;
  active.add(id);
  // Orçamento global compartilhado pelo monitor e botão Atualizar: até 2 consultas/s.
  nextQueryAt = Date.now() + 500;
  const session = m.nix_session_id;
  const stillCurrent = () => match(id)?.nix_session_id === session;
  db.prepare('UPDATE matches SET nix_poll_at = ? WHERE id = ?').run(Date.now() + pollMs, id);
  try {
    if (m.status === 'SALA_CRIADA') {
      const data = await api.membros(session);
      if (!stillCurrent()) return false;
      rosters.set(session, data.members || []);
      if (data.status === 'started') {
        await require('./partida').iniciarPartidaAutomatico(client, id, true);
      }
      await publicar(client, id, data.members || []);
      return true;
    }
    if (!m.em_andamento_em) return false;
    const result = await api.resultado(session);
    if (!stillCurrent()) return false;
    if (result.status === 'finalizada') {
      db.prepare('UPDATE matches SET nix_result_json = ? WHERE id = ?').run(JSON.stringify(result), id);
      if (!m.nix_result_msg_id) {
        const channel = await client.channels.fetch(m.thread_id);
        const message = await channel.send(resultadoEmbed(m, result));
        db.prepare('UPDATE matches SET nix_result_msg_id = ? WHERE id = ?').run(message.id, id);
      }
      await require('./partida').liberarResultado(client, id);
      await publicar(client, id, (result.teams || []).flatMap(t => (t.players || []).map(p => ({
        ...p, player_uid: p.account_id, slot: '—', team: t.team,
      }))));
    }
    if (result.poll_after_seconds === null || result.status === 'finalizada' || result.status === 'no_match') {
      rosters.delete(session);
      db.prepare('UPDATE matches SET nix_poll_done = 1 WHERE id = ?').run(id);
      if (result.status === 'no_match') {
        const channel = await client.channels.fetch(m.thread_id);
        await channel.send('⚠️ Não foi possível detectar uma partida concluída nesta sala. Procurem o suporte para conferir.');
      }
    } else {
      const seconds = Math.max(pollMs / 1000, Number(result.poll_after_seconds) || 20);
      db.prepare('UPDATE matches SET nix_poll_at = ? WHERE id = ?').run(Date.now() + seconds * 1000, id);
    }
    return true;
  } catch (e) {
    if (e.status === 404 && m.status === 'SALA_CRIADA' && stillCurrent()) {
      // Após o start, /members expira antes de /result. O resultado comprova o início.
      try {
        const result = await api.resultado(session);
        if (stillCurrent() && ['jogando', 'finalizada', 'no_match'].includes(result.status)) {
          await require('./partida').iniciarPartidaAutomatico(client, id, true);
        }
      } catch (recoveryError) {
        if (recoveryError.status === 429) blockedUntil = Date.now() + Math.max(60, Number(recoveryError.retryAfter) || 60) * 1000;
      }
    }
    if (e.status === 429) blockedUntil = Date.now() + Math.max(60, Number(e.retryAfter) || 60) * 1000;
    if (e.status === 401 || e.status === 403) blockedUntil = Date.now() + 60000;
    if (stillCurrent()) db.prepare('UPDATE matches SET nix_poll_at = ? WHERE id = ?').run(Math.max(Date.now() + 30000, blockedUntil), id);
    // /result pode retornar 404 enquanto o tracking ainda está sendo criado.
    if (e.status !== 404) console.warn(`[nix #${id}] consulta falhou (HTTP ${e.status || 'conexão'})`);
    return false;
  } finally { active.delete(id); }
}

async function varrer(client) {
  if (sweeping || !cfg.nixSalas.apiKey || Date.now() < blockedUntil) return;
  sweeping = true;
  try {
    const rows = db.prepare(`SELECT id FROM matches WHERE nix_session_id IS NOT NULL
      AND nix_poll_done = 0 AND nix_poll_at <= ? AND status != 'CANCELADA'
      AND (status = 'SALA_CRIADA' OR em_andamento_em > ?)
      ORDER BY nix_poll_at LIMIT 20`).all(Date.now(), Date.now() - 40 * 60000);
    for (const m of rows) {
      if (Date.now() < blockedUntil) break;
      const wait = nextQueryAt - Date.now();
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      await atualizar(client, m.id);
    }
  } finally { sweeping = false; }
}

async function acao(interaction, id, action) {
  const m = match(id);
  const partida = require('./partida');
  if (!m || !m.nix_session_id || m.thread_id !== interaction.channelId ||
      (!partida.ehJogador(m, interaction.user.id) && !gc.hasRole(interaction.member, 'cargo_staff'))) {
    return interaction.reply({ content: 'Você não tem acesso a esta sala.', flags: 64 });
  }
  await interaction.deferReply({ flags: 64 });
  if (action === 'nix_copy') return interaction.editReply(`${m.nix_room_id}\n${m.nix_room_password}`);
  if (m.status !== 'SALA_CRIADA') return interaction.editReply('A sala não está mais aguardando jogadores.');
  if (action === 'nix_refresh') {
    const ok = await atualizar(interaction.client, id);
    return interaction.editReply(ok ? 'Painel atualizado.' : 'Aguarde a próxima atualização automática (ou a liberação do limite da API).');
  }
  return interaction.editReply({ content: 'O controle de expulsão foi removido.', components: [] });
}
module.exports = { painel, inicioEmbed, resultadoEmbed, publicar, publicarInicio, atualizar, varrer, acao };
