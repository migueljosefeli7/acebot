const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const emo = require('../lib/emojis');
const elo = require('./elo');

/* ---------------------------------------------------------------- DADOS */

const getCaixa = (id) => db.prepare('SELECT * FROM caixas WHERE id = ?').get(id);
const listarCaixas = (guildId, soAtivas = false) => db.prepare(
  `SELECT * FROM caixas WHERE guild_id = ?${soAtivas ? ' AND ativo = 1' : ''} ORDER BY preco ASC`
).all(guildId);

const getPremios = (caixaId) =>
  db.prepare('SELECT * FROM caixa_premios WHERE caixa_id = ? ORDER BY peso DESC').all(caixaId);

function criarCaixa(guildId, { nome, descricao, preco, imagemUrl, criadoPor }) {
  const info = db.prepare(
    `INSERT INTO caixas (guild_id, nome, descricao, preco, imagem_url, criado_por, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(guildId, nome, descricao || null, preco, imagemUrl || null, criadoPor, Date.now());
  return info.lastInsertRowid;
}

function addPremio(caixaId, { nome, peso, cor }) {
  const info = db.prepare(
    'INSERT INTO caixa_premios (caixa_id, nome, peso, cor, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(caixaId, nome, peso, cor || null, Date.now());
  return info.lastInsertRowid;
}

/* ------------------------------------------------------------- SORTEIO */

/** Sorteio ponderado: cada premio tem uma fatia proporcional ao peso dele. */
function sortear(premios) {
  const total = premios.reduce((s, p) => s + p.peso, 0);
  if (total <= 0) return null;

  let alvo = Math.random() * total;
  for (const p of premios) {
    alvo -= p.peso;
    if (alvo <= 0) return p;
  }
  return premios[premios.length - 1]; // arredondamento de ponto flutuante
}

/** Estatistica de drop rate — usado no painel para mostrar as chances reais. */
function chances(premios) {
  const total = premios.reduce((s, p) => s + p.peso, 0);
  return premios.map((p) => ({ ...p, chance: total > 0 ? (p.peso / total) * 100 : 0 }));
}

/**
 * Abre a caixa: debita pontos, sorteia, registra a abertura.
 * Tudo numa transacao — se o sorteio falhar (sem premio cadastrado), os
 * pontos nao saem do bolso do jogador.
 */
const abrir = db.transaction((guildId, caixaId, userId) => {
  const caixa = getCaixa(caixaId);
  if (!caixa || caixa.guild_id !== guildId) return { erro: 'NAO_EXISTE' };
  if (!caixa.ativo) return { erro: 'INATIVA' };

  const premios = getPremios(caixaId);
  if (!premios.length) return { erro: 'SEM_PREMIOS' };

  const pontos = elo.getPontos(userId);
  if (pontos < caixa.preco) return { erro: 'SEM_PONTOS', pontos, falta: caixa.preco - pontos };

  const premio = sortear(premios);
  if (!premio) return { erro: 'SEM_PREMIOS' };

  elo.darPontos(userId, -caixa.preco, `Abriu a caixa: ${caixa.nome}`, `caixa:${caixaId}`);

  const info = db.prepare(
    'INSERT INTO caixa_aberturas (caixa_id, premio_id, user_id, guild_id, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(caixaId, premio.id, userId, guildId, Date.now());

  return { ok: true, caixa, premio, aberturaId: info.lastInsertRowid, pontosDepois: elo.getPontos(userId) };
});

const historicoAberturas = (caixaId, limite = 15) => db.prepare(
  `SELECT a.*, p.nome AS premio_nome FROM caixa_aberturas a
   JOIN caixa_premios p ON p.id = a.premio_id
   WHERE a.caixa_id = ? ORDER BY a.id DESC LIMIT ?`
).all(caixaId, limite);

/* ---------------------------------------------------------------- PAINEL */

function painelCaixa(caixa) {
  const premios = chances(getPremios(caixa.id));
  const linhas = premios.map((p) =>
    `**${p.nome}** — \`${p.chance.toFixed(1)}%\` de chance`);

  return ui.bloco(cfg.COR.primaria,
    ui.titulo(`${emo.caixa} ${caixa.nome}`),
    ui.nota(`Custa ${caixa.preco} pontos por abertura`),
    caixa.imagem_url ? ui.imagem(caixa.imagem_url) : null,
    ui.divisor(),
    caixa.descricao ? ui.txt(caixa.descricao) : null,
    ui.secao('🎲 Prêmios possíveis'),
    ui.txt(linhas.join('\n')),
    ui.divisor(),
    ui.linhaBotoes(
      ui.botao(`caixa:abrir:${caixa.id}`, `ABRIR (${caixa.preco} pts)`, { estilo: ui.ESTILO.Success, emoji: emo.caixa }),
    ),
    ui.nota('O sorteio é ponderado pelas chances acima — cada abertura é independente.'),
  );
}

function painelResultado(caixa, premio, pontosDepois) {
  return ui.bloco(premio.cor || cfg.COR.sucesso,
    ui.titulo(`${emo.caixa} VOCÊ ABRIU: ${premio.nome}`),
    ui.nota(caixa.nome),
    ui.divisor(),
    ui.txt(`🎉 Parabéns! Você ganhou **${premio.nome}**.`),
    ui.nota(`Pontos restantes: ${pontosDepois}`),
  );
}

function painelListagem(guildId) {
  const caixas = listarCaixas(guildId, true);
  const linhas = caixas.map((c) => `${emo.caixa} \`#${c.id}\` **${c.nome}** — ${c.preco} pontos`);

  return ui.bloco(cfg.COR.primaria,
    ui.titulo(`${emo.caixa} CAIXAS DISPONÍVEIS`),
    ui.divisor(),
    caixas.length ? ui.txt(linhas.join('\n')) : ui.txt('_Nenhuma caixa disponível no momento._'),
    ui.nota('Use /caixa abrir para escolher uma.'),
  );
}

module.exports = {
  getCaixa, listarCaixas, getPremios, criarCaixa, addPremio,
  sortear, chances, abrir, historicoAberturas,
  painelCaixa, painelResultado, painelListagem,
};
