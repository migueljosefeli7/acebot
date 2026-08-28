const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const wallet = require('../lib/wallet');

/**
 * Escada de elos no estilo Valorant: 8 patentes com 3 divisões cada,
 * mais o topo único (Radiante). São 25 degraus no total.
 *
 * `min` é o total de pontos necessário para estar naquele degrau.
 */
const PATENTES = [
  { nome: 'Ferro', emoji: '🟤', cor: 0x5C4033 },
  { nome: 'Bronze', emoji: '🟫', cor: 0xA0662E },
  { nome: 'Prata', emoji: '⚪', cor: 0xB8C4C9 },
  { nome: 'Ouro', emoji: '🟡', cor: 0xE0B549 },
  { nome: 'Platina', emoji: '🔵', cor: 0x36B5B5 },
  { nome: 'Diamante', emoji: '🟣', cor: 0xB57BE0 },
  { nome: 'Ascendente', emoji: '🟢', cor: 0x21B573 },
  { nome: 'Imortal', emoji: '🔴', cor: 0xC02B4B },
];

const PONTOS_POR_DIVISAO = 100;

/** Lista completa dos degraus, do mais baixo ao mais alto. */
const ELOS = (() => {
  const lista = [];
  PATENTES.forEach((p, iPatente) => {
    for (let div = 1; div <= 3; div++) {
      const i = iPatente * 3 + (div - 1);
      lista.push({
        key: `${p.nome.toUpperCase()}_${div}`,
        nome: `${p.nome} ${div}`,
        emoji: p.emoji,
        cor: p.cor,
        min: i * PONTOS_POR_DIVISAO,
      });
    }
  });
  lista.push({
    key: 'RADIANTE',
    nome: 'Radiante',
    emoji: '✨',
    cor: 0xFFF4B0,
    min: lista.length * PONTOS_POR_DIVISAO,
  });
  return lista;
})();

const porKey = (key) => ELOS.find((e) => e.key === key) || null;

/** Elo correspondente a uma pontuação. */
function eloDe(pontos) {
  let atual = ELOS[0];
  for (const e of ELOS) if (pontos >= e.min) atual = e;
  return atual;
}

/** Próximo degrau e quanto falta. `null` quando já está no topo. */
function proximo(pontos) {
  const i = ELOS.indexOf(eloDe(pontos));
  const prox = ELOS[i + 1];
  return prox ? { elo: prox, falta: prox.min - pontos } : null;
}

/** Barra de progresso dentro do degrau atual. */
function barra(pontos, tamanho = 12) {
  const atual = eloDe(pontos);
  const prox = proximo(pontos);
  if (!prox) return '█'.repeat(tamanho) + ' MÁXIMO';
  const faixa = prox.elo.min - atual.min;
  const feito = Math.max(0, Math.min(faixa, pontos - atual.min));
  const cheio = Math.round((feito / faixa) * tamanho);
  return '█'.repeat(cheio) + '░'.repeat(tamanho - cheio) + ` ${feito}/${faixa}`;
}

/* ---------------------------------------------------------------- PONTOS */

const getPontos = (userId) => wallet.ensureUser(userId).pontos;

/**
 * Soma (ou tira) pontos. Nunca deixa negativo — quem está no fundo do Ferro
 * não fica devendo, só não desce mais.
 */
const darPontos = db.transaction((userId, delta, motivo, ref) => {
  const u = wallet.ensureUser(userId);
  const antes = u.pontos;
  const depois = Math.max(0, antes + delta);
  const real = depois - antes;

  db.prepare('UPDATE users SET pontos = ?, pontos_pico = MAX(pontos_pico, ?) WHERE discord_id = ?')
    .run(depois, depois, userId);
  db.prepare('INSERT INTO pontos_log (user_id, delta, saldo, motivo, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, real, depois, motivo || null, ref || null, Date.now());

  const eloAntes = eloDe(antes);
  const eloDepois = eloDe(depois);
  db.prepare('UPDATE users SET elo = ? WHERE discord_id = ?').run(eloDepois.key, userId);

  return {
    antes, depois, delta: real,
    eloAntes, eloDepois,
    subiu: eloDepois.min > eloAntes.min,
    caiu: eloDepois.min < eloAntes.min,
  };
});

const extratoPontos = (userId, limite = 10) =>
  db.prepare('SELECT * FROM pontos_log WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limite);

/* ---------------------------------------------------------------- CARGOS */

const cargoDe = (guildId, eloKey) =>
  db.prepare('SELECT role_id FROM elo_cargos WHERE guild_id = ? AND elo = ?').get(guildId, eloKey)?.role_id || null;

const definirCargo = (guildId, eloKey, roleId) =>
  db.prepare(`INSERT INTO elo_cargos (guild_id, elo, role_id) VALUES (?, ?, ?)
              ON CONFLICT(guild_id, elo) DO UPDATE SET role_id = excluded.role_id`)
    .run(guildId, eloKey, roleId);

const todosOsCargos = (guildId) =>
  db.prepare('SELECT * FROM elo_cargos WHERE guild_id = ?').all(guildId);

/**
 * Deixa o membro só com o cargo do elo atual, tirando os outros.
 * Silencioso quando o bot não tem permissão — o erro vai para o console.
 */
async function sincronizarCargo(client, guildId, userId, eloKey) {
  const mapa = todosOsCargos(guildId);
  if (!mapa.length) return { ok: false, motivo: 'SEM_CARGOS' };

  try {
    const guild = await client.guilds.fetch(guildId);
    const membro = await guild.members.fetch(userId);

    const alvo = mapa.find((c) => c.elo === eloKey)?.role_id || null;
    const remover = mapa.filter((c) => c.role_id !== alvo && membro.roles.cache.has(c.role_id))
      .map((c) => c.role_id);

    if (remover.length) await membro.roles.remove(remover, 'Atualização de elo');
    if (alvo && !membro.roles.cache.has(alvo)) await membro.roles.add(alvo, 'Atualização de elo');

    return { ok: true, aplicado: alvo, removidos: remover.length };
  } catch (e) {
    console.error(`[elo] não consegui aplicar o cargo de ${userId}: ${e.message}\n` +
      '   O cargo do bot precisa estar ACIMA dos cargos de elo na lista de cargos.');
    return { ok: false, motivo: e.message };
  }
}

/**
 * Ponto único usado pelas partidas: dá os pontos, arruma o cargo e devolve
 * o que mudou para quem chamou anunciar.
 */
async function registrar(client, guildId, userId, delta, motivo, ref) {
  const r = darPontos(userId, delta, motivo, ref);
  if (r.subiu || r.caiu) await sincronizarCargo(client, guildId, userId, r.eloDepois.key);
  return r;
}

/* ---------------------------------------------------------------- PAINEL */

function painelPromocao(userId, r) {
  const subiu = r.subiu;
  return ui.bloco(subiu ? r.eloDepois.cor : cfg.COR.neutro,
    ui.titulo(subiu ? '📈 SUBIU DE ELO!' : '📉 CAIU DE ELO'),
    ui.txt(`<@${userId}>`),
    ui.divisor(),
    ui.txt(
      `${r.eloAntes.emoji} **${r.eloAntes.nome}**  →  ${r.eloDepois.emoji} **${r.eloDepois.nome}**`
    ),
    ui.tabela([
      ['Pontos', String(r.depois)],
      ['Variacao', `${r.delta >= 0 ? '+' : ''}${r.delta}`],
    ]),
  );
}

function painelElo(user) {
  const u = wallet.ensureUser(user.id);
  const atual = eloDe(u.pontos);
  const prox = proximo(u.pontos);
  const pos = posicao(user.id);

  return ui.bloco(atual.cor,
    ui.comThumb(
      [`## ${atual.emoji} ${atual.nome.toUpperCase()}`,
        `<@${user.id}> · **${u.pontos} pontos**`],
      user.displayAvatarURL({ extension: 'png' }),
    ),
    ui.divisor(),
    ui.txt('`' + barra(u.pontos) + '`'),
    prox
      ? ui.txt(`Faltam **${prox.falta} pontos** para ${prox.elo.emoji} **${prox.elo.nome}**`)
      : ui.txt('🏆 Você está no **topo da escada**.'),
    ui.divisor(),
    ui.tabela([
      ['Posicao no ranking', pos ? `#${pos}` : 'sem ranking'],
      ['Pico de pontos', String(u.pontos_pico)],
      ['Vitorias', String(u.wins)],
      ['Derrotas', String(u.losses)],
    ]),
  );
}

/** Posição do jogador no ranking geral (1 = primeiro). */
const posicao = (userId) => {
  const u = db.prepare('SELECT pontos FROM users WHERE discord_id = ?').get(userId);
  if (!u || u.pontos <= 0) return null;
  return db.prepare('SELECT COUNT(*) c FROM users WHERE pontos > ?').get(u.pontos).c + 1;
};

module.exports = {
  ELOS, PATENTES, PONTOS_POR_DIVISAO,
  eloDe, proximo, barra, porKey, posicao,
  getPontos, darPontos, extratoPontos, registrar,
  cargoDe, definirCargo, todosOsCargos, sincronizarCargo,
  painelPromocao, painelElo,
};
