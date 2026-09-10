const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, escapeMarkdown } = require('discord.js');
const db = require('../db/database');
const api = require('../lib/nixSalas');
const cfg = require('../config');
const gc = require('../lib/guildconfig');
const active = new Set();
const rosters = new Map();
let sweeping = false;
let blockedUntil = 0;
const clean = (v) => escapeMarkdown(String(v ?? '—')).replace(/@/g, '@\u200b').slice(0, 80);
const match = (id) => require('./partida').get(id);
const row = (...buttons) => new ActionRowBuilder().addComponents(buttons);
const button = (id, label, style, disabled = false) => new ButtonBuilder()
  .setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);

function painel(m, members, icon) {
  const waiting = m.status === 'SALA_CRIADA';
  const players = (members || []).filter(p => !p.is_owner).slice(0, 8)
    .sort((a, b) => Number(a.slot) - Number(b.slot));
  const list = members == null ? 'Consultando jogadores…' : players.length ? players.map(p =>
    `**Slot ${clean(p.slot)} · Time ${clean(p.team)}** — ${p.platform === 'mobile' ? '📱 Mobile' : p.platform === 'emulator' ? '🖥️ Emulador' : '❔ Não informado'}\n${clean(p.nickname)} · UID: \`${clean(p.player_uid)}\``
  ).join('\n') : 'Nenhum jogador na sala';
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
      button(`match:nix_kick:${m.id}`, 'Expulsar', ButtonStyle.Danger, !waiting),
      button(`match:nix_refresh:${m.id}`, 'Atualizar', ButtonStyle.Primary, !waiting)),
    row(button(`match:nix_copy:${m.id}`, 'Copiar ID e Senha', ButtonStyle.Secondary)),
  ];
  if (m.nix_invite_link && /^https:\/\/ffshare\.garena\.com\//.test(m.nix_invite_link)) {
    components[1].addComponents(new ButtonBuilder().setLabel('Link da Sala').setStyle(ButtonStyle.Link).setURL(m.nix_invite_link));
  }
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

async function publicar(client, id, members = null) {
  const m = match(id);
  if (!m?.nix_session_id || !m.thread_id) return;
  if (members != null) rosters.set(m.nix_session_id, members);
  else members = rosters.get(m.nix_session_id) || null;
  const thread = await client.channels.fetch(m.thread_id);
  const payload = painel(m, members, client.user.displayAvatarURL());
  if (m.nix_panel_id) {
    try { await thread.messages.edit(m.nix_panel_id, payload); return; }
    catch (e) { if (e.code !== 10008) throw e; }
  }
  const message = await thread.send(payload);
  db.prepare('UPDATE matches SET nix_panel_id = ? WHERE id = ?').run(message.id, id);
}

function resultadoEmbed(m, data) {
  const embed = new EmbedBuilder().setColor(0xff0101).setTitle('🏆 Resultado da Partida')
    .setDescription(`Sala **${m.nix_room_id}** · Partida **#${m.id}**\n` +
      (data.winner_team == null ? 'Vencedor não informado pela API.' : `**Time vencedor: ${clean(data.winner_team)}**`));
  for (const team of (data.teams || []).slice(0, 2)) {
    embed.addFields({ name: `Time ${clean(team.team)}${team.is_winner ? ' 🏆' : ''}`, value:
      (team.players || []).slice(0, 4).map(p =>
        `${clean(p.nickname)} · UID \`${clean(p.account_id)}\`\nAbates: **${p.kills ?? '—'}** · ${p.platform === 'mobile' ? '📱 Mobile' : p.platform === 'emulator' ? '🖥️ Emulador' : 'Dispositivo não informado'}${String(team.team_mvp_account_id) === String(p.account_id) ? ' · ⭐ MVP do time' : ''}`
      ).join('\n') || 'Sem dados' });
  }
  if (data.match_mvp) embed.addFields({ name: '⭐ MVP da partida',
    value: `${clean(data.match_mvp.nickname)} · ${data.match_mvp.kills ?? '—'} abates` });
  embed.setFooter({ text: 'Resultado informado pela Nix. Confirme o vencedor no painel da partida.' });
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

async function atualizar(client, id) {
  if (active.has(id) || Date.now() < blockedUntil) return false;
  let m = match(id);
  if (!m?.nix_session_id || m.nix_poll_done || Date.now() < m.nix_poll_at) return false;
  active.add(id);
  const session = m.nix_session_id;
  const stillCurrent = () => match(id)?.nix_session_id === session;
  db.prepare('UPDATE matches SET nix_poll_at = ? WHERE id = ?').run(Date.now() + 15000, id);
  try {
    if (m.status === 'SALA_CRIADA') {
      const data = await api.membros(session);
      if (!stillCurrent()) return false;
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
        await channel.send('⚠️ A Nix não detectou uma partida concluída nesta sala. Procurem o suporte para conferir.');
      }
    } else {
      const seconds = Math.max(10, Number(result.poll_after_seconds) || 20);
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
    for (const m of rows) await atualizar(client, m.id);
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
  // Somente a staff expulsa: os capitães não devem poder remover o adversário.
  if (!gc.hasRole(interaction.member, 'cargo_staff')) return interaction.editReply('Somente a staff pode expulsar jogadores.');
  try {
    const data = await api.membros(m.nix_session_id);
    const players = (data.members || []).filter(p => !p.is_owner).slice(0, 8);
    if (action === 'nix_kick_confirm') {
      const [session, uid] = String(interaction.values[0]).split('|');
      if (session !== m.nix_session_id || !players.some(p => String(p.player_uid) === uid) || match(id).status !== 'SALA_CRIADA') {
        return interaction.editReply('Jogador ou sessão mudou. Abra o menu novamente.');
      }
      await api.expulsar(session, uid);
      db.prepare('UPDATE matches SET nix_poll_at = 0 WHERE id = ?').run(id);
      await atualizar(interaction.client, id);
      return interaction.editReply({ content: 'Expulsão solicitada. O painel acompanha a lista real da sala.', components: [] });
    }
    if (!players.length) return interaction.editReply('Nenhum jogador para expulsar.');
    const menu = new StringSelectMenuBuilder().setCustomId(`nix:nix_kick_confirm:${id}`)
      .setPlaceholder('Selecione para confirmar a expulsão').addOptions(players.map(p => ({
        label: String(p.nickname || p.player_uid).slice(0, 100),
        description: `Slot ${p.slot} · Time ${p.team} · UID ${p.player_uid}`.slice(0, 100),
        value: `${m.nix_session_id}|${p.player_uid}`,
      })));
    return interaction.editReply({ content: 'Selecione o jogador que deseja expulsar:', components: [row(menu)] });
  } catch (e) {
    return interaction.editReply(`Não foi possível consultar/expulsar agora (HTTP ${e.status || 'conexão'}). Tente novamente depois.`);
  }
}
module.exports = { painel, resultadoEmbed, publicar, atualizar, varrer, acao };
