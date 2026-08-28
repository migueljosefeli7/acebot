const { ChannelType, StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');

const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const gc = require('../lib/guildconfig');
const notificar = require('../lib/notificar');
const elo = require('./elo');

const getItem = (id) => db.prepare('SELECT * FROM loja_itens WHERE id = ?').get(id);
const getPedido = (id) => db.prepare('SELECT * FROM loja_pedidos WHERE id = ?').get(id);

const itensAtivos = (guildId) => db.prepare(
  `SELECT * FROM loja_itens WHERE guild_id = ? AND ativo = 1
   AND (estoque = -1 OR estoque > 0) ORDER BY preco ASC`
).all(guildId);

const todosItens = (guildId) =>
  db.prepare('SELECT * FROM loja_itens WHERE guild_id = ? ORDER BY preco ASC').all(guildId);

const estoqueTxt = (i) => (i.estoque === -1 ? 'ilimitado' : `${i.estoque} restante(s)`);

/* ------------------------------------------------------------ PAINEL FIXO */

function painel(guildId) {
  const itens = itensAtivos(guildId);

  const blocos = itens.length
    ? itens.map((i) =>
        `**${i.nome}** — \`${i.preco} pts\`\n` +
        `└ ${i.descricao || '_sem descrição_'} · ${estoqueTxt(i)}`)
    : ['_Nenhum item disponível no momento._'];

  const componentes = [
    ui.titulo('🛒 LOJA DE PONTOS'),
    ui.nota('Troque os pontos que você ganhou nas partidas'),
    ui.divisor(),
    ui.txt(blocos.join('\n\n')),
    ui.divisor(),
  ];

  if (itens.length) {
    // O menu já mostra preço e estoque, então dá para escolher sem sair do painel.
    componentes.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('loja:comprar')
        .setPlaceholder('Escolha o que quer resgatar')
        .addOptions(itens.slice(0, 25).map((i) => ({
          label: i.nome.slice(0, 100),
          description: `${i.preco} pontos · ${estoqueTxt(i)}`.slice(0, 100),
          value: String(i.id),
        }))),
    ));
  }

  componentes.push(
    ui.linhaBotoes(
      ui.botao('rank:meu', 'MEUS PONTOS', { estilo: ui.ESTILO.Primary, emoji: '🎖️' }),
      ui.botao('loja:meus', 'MEUS PEDIDOS', { emoji: '📦' }),
    ),
    ui.nota('Ao resgatar, abre um ticket e a staff entrega o prêmio.'),
  );

  return ui.bloco(cfg.COR.primaria, ...componentes);
}

async function atualizarPainel(client, guildId) {
  const canal = await gc.channel(client, guildId, 'canal_loja');
  if (!canal) return;

  const msgId = gc.get(guildId, 'mensagem_loja');
  try {
    if (msgId) {
      const msg = await canal.messages.fetch(msgId);
      await msg.edit(ui.msg(painel(guildId)));
      return;
    }
  } catch { /* apagada: publica de novo */ }

  const nova = await canal.send(ui.msg(painel(guildId)));
  gc.set(guildId, 'mensagem_loja', nova.id);
}

/* ---------------------------------------------------------------- COMPRA */

/**
 * Debita os pontos e cria o pedido numa transação só.
 * O estoque cai aqui: sem isso dois cliques ao mesmo tempo furam o limite.
 */
const comprar = db.transaction((guildId, itemId, userId) => {
  const item = getItem(itemId);
  if (!item || item.guild_id !== guildId) return { erro: 'ITEM_INEXISTENTE' };
  if (!item.ativo) return { erro: 'ITEM_INATIVO' };
  if (item.estoque === 0) return { erro: 'SEM_ESTOQUE' };

  const pontos = elo.getPontos(userId);
  if (pontos < item.preco) return { erro: 'SEM_PONTOS', pontos, falta: item.preco - pontos };

  const pendentes = db.prepare(
    "SELECT COUNT(*) c FROM loja_pedidos WHERE user_id = ? AND status = 'PENDENTE'"
  ).get(userId).c;
  if (pendentes >= 3) return { erro: 'MUITOS_PEDIDOS', pendentes };

  if (item.estoque > 0) {
    const baixa = db.prepare('UPDATE loja_itens SET estoque = estoque - 1 WHERE id = ? AND estoque > 0').run(itemId);
    if (baixa.changes === 0) return { erro: 'SEM_ESTOQUE' };
  }
  db.prepare('UPDATE loja_itens SET vendidos = vendidos + 1 WHERE id = ?').run(itemId);

  elo.darPontos(userId, -item.preco, `Resgate na loja: ${item.nome}`, `loja:${itemId}`);

  const info = db.prepare(
    `INSERT INTO loja_pedidos (guild_id, item_id, item_nome, user_id, preco, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(guildId, itemId, item.nome, userId, item.preco, Date.now());

  return { ok: true, item, pedidoId: Number(info.lastInsertRowid), pontosDepois: elo.getPontos(userId) };
});

/** Abre o ticket de entrega e avisa a staff. */
async function abrirPedido(client, guildId, pedidoId) {
  const p = getPedido(pedidoId);
  if (!p) return null;

  const canal = await gc.channel(client, guildId, 'canal_pedidos_loja');
  if (!canal) {
    console.error('[loja] canal_pedidos_loja nao configurado — use /config canal canal_pedidos_loja');
    return null;
  }

  const thread = await canal.threads.create({
    name: `🛒 #${p.id} · ${p.item_nome}`.slice(0, 100),
    autoArchiveDuration: 4320,
    type: ChannelType.PrivateThread,
    invitable: false,
    reason: `Pedido #${p.id}`,
  });
  db.prepare('UPDATE loja_pedidos SET thread_id = ? WHERE id = ?').run(thread.id, p.id);

  await thread.members.add(p.user_id).catch(() => {});

  const cargoStaff = gc.get(guildId, 'cargo_staff');
  const item = getItem(p.item_id);

  const msg = await thread.send(ui.msg(ui.bloco(cfg.COR.aviso,
    ui.titulo(`🛒 PEDIDO #${p.id}`),
    ui.nota('Aguardando a staff entregar'),
    ui.divisor(),
    ui.txt(`${cargoStaff ? `<@&${cargoStaff}>\n\n` : ''}Comprador: <@${p.user_id}>`),
    ui.divisor(),
    ui.tabela([
      ['Item', p.item_nome],
      ['Custo', `${p.preco} pontos`],
      ['Pontos restantes', String(elo.getPontos(p.user_id))],
    ]),
    item?.descricao ? ui.txt(`**Descrição:** ${item.descricao}`) : null,
    ui.divisor(),
    ui.txt(
      '<@' + p.user_id + '>, descreva aqui o que a staff precisa saber para te entregar ' +
      '(nick no jogo, ID, forma de contato...).'
    ),
    ui.linhaBotoes(
      ui.botao(`loja:entregue:${p.id}`, 'MARCAR COMO ENTREGUE', { estilo: ui.ESTILO.Success, emoji: '✅' }),
      ui.botao(`loja:cancelar:${p.id}`, 'CANCELAR E DEVOLVER', { estilo: ui.ESTILO.Danger, emoji: '↩️' }),
    ),
    ui.nota('Só a staff pode usar esses botões.'),
  )));
  await msg.pin().catch(() => {});

  await notificar.chamarCargo(client, guildId, 'cargo_staff', {
    titulo: '🛒 NOVO PEDIDO NA LOJA',
    descricao: `**Pedido #${p.id}** — <@${p.user_id}> resgatou um item.`,
    dados: [['Item', p.item_nome], ['Custo', `${p.preco} pontos`]],
    canalId: thread.id,
    rotuloBotao: 'IR PARA O PEDIDO',
  });

  return thread;
}

/* ------------------------------------------------------------- RESOLUCAO */

/** Devolve os pontos e repõe o estoque quando o pedido é cancelado. */
const desfazer = db.transaction((p) => {
  elo.darPontos(p.user_id, p.preco, `Pedido #${p.id} cancelado: ${p.item_nome}`, `loja:${p.item_id}`);
  const item = getItem(p.item_id);
  if (item && item.estoque >= 0) {
    db.prepare('UPDATE loja_itens SET estoque = estoque + 1 WHERE id = ?').run(p.item_id);
  }
  db.prepare('UPDATE loja_itens SET vendidos = MAX(0, vendidos - 1) WHERE id = ?').run(p.item_id);
});

async function resolverPedido(interaction, pedidoId, entregue, observacao) {
  const p = getPedido(pedidoId);
  if (!p) {
    return interaction.reply(ui.msg(ui.bloco(cfg.COR.erro,
      ui.titulo('❌ Pedido não encontrado'), ui.txt(`Não existe pedido #${pedidoId}.`)), { efemero: true }));
  }
  if (p.status !== 'PENDENTE') {
    return interaction.reply(ui.msg(ui.bloco(cfg.COR.erro,
      ui.titulo('❌ Já resolvido'), ui.txt(`Esse pedido já está como **${p.status}**.`)), { efemero: true }));
  }

  if (!entregue) desfazer(p);

  db.prepare('UPDATE loja_pedidos SET status = ?, staff_id = ?, observacao = ?, resolved_at = ? WHERE id = ?')
    .run(entregue ? 'ENTREGUE' : 'CANCELADO', interaction.user.id, observacao || null, Date.now(), pedidoId);

  await interaction.update(ui.msg(ui.bloco(entregue ? cfg.COR.sucesso : cfg.COR.neutro,
    ui.titulo(`🛒 PEDIDO #${pedidoId} · ${entregue ? 'ENTREGUE' : 'CANCELADO'}`),
    ui.txt(`Comprador: <@${p.user_id}> · Resolvido por <@${interaction.user.id}>`),
    ui.divisor(),
    ui.tabela([
      ['Item', p.item_nome],
      ['Custo', `${p.preco} pontos`],
      [entregue ? 'Status' : 'Pontos devolvidos', entregue ? 'entregue' : String(p.preco)],
    ]),
    observacao ? ui.txt(`**Observação:** ${observacao}`) : null,
  )));

  try {
    const user = await interaction.client.users.fetch(p.user_id);
    await user.send(ui.msg(ui.bloco(entregue ? cfg.COR.sucesso : cfg.COR.neutro,
      ui.titulo(entregue ? '✅ PEDIDO ENTREGUE' : '↩️ PEDIDO CANCELADO'),
      ui.divisor(),
      ui.tabela([['Item', p.item_nome], ['Pontos', String(p.preco)]]),
      ui.txt(entregue
        ? 'Seu prêmio foi entregue. Bom proveito!'
        : `Os **${p.preco} pontos** voltaram para a sua conta.${observacao ? `\n\n**Motivo:** ${observacao}` : ''}`),
      ui.nota(`Pedido #${pedidoId}`),
    )));
  } catch { /* DM fechada */ }

  const thread = interaction.channel;
  if (thread?.isThread?.()) {
    setTimeout(() => {
      thread.setLocked(true).catch(() => {});
      thread.setArchived(true).catch(() => {});
    }, 20_000);
  }

  await atualizarPainel(interaction.client, p.guild_id);
}

/* --------------------------------------------------------- MEUS PEDIDOS */

const ROTULO = { PENDENTE: '⏳ Aguardando', ENTREGUE: '✅ Entregue', CANCELADO: '↩️ Cancelado' };

function meusPedidos(userId) {
  const rows = db.prepare('SELECT * FROM loja_pedidos WHERE user_id = ? ORDER BY id DESC LIMIT 10').all(userId);
  const linhas = rows.map((p) =>
    `\`#${p.id}\` **${p.item_nome}** · ${p.preco} pts · ${ROTULO[p.status] || p.status}` +
    (p.status === 'PENDENTE' && p.thread_id ? `\n└ <#${p.thread_id}>` : ''));

  return ui.bloco(cfg.COR.neutro,
    ui.titulo('📦 MEUS PEDIDOS'),
    ui.divisor(),
    ui.lista(linhas),
    ui.nota('Mostrando os 10 mais recentes.'),
  );
}

module.exports = {
  getItem, getPedido, itensAtivos, todosItens, estoqueTxt,
  painel, atualizarPainel, comprar, abrirPedido, resolverPedido, meusPedidos,
};
