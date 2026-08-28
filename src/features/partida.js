const {
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ChannelType,
  StringSelectMenuBuilder,
} = require('discord.js');

const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const money = require('../lib/money');
const wallet = require('../lib/wallet');
const logs = require('../lib/logs');
const gc = require('../lib/guildconfig');
const notificar = require('../lib/notificar');
const banners = require('../lib/banners');

const get = (id) => db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
const getByThread = (threadId) => db.prepare('SELECT * FROM matches WHERE thread_id = ? ORDER BY id DESC LIMIT 1').get(threadId);
const setStatus = (id, status) => db.prepare('UPDATE matches SET status = ? WHERE id = ?').run(status, id);
const oponente = (m, userId) => (m.p1 === userId ? m.p2 : m.p1);
const ehJogador = (m, userId) => m.p1 === userId || m.p2 === userId;
const premio = (m) => m.valor * 2 - m.taxa;
const modo = (m) => (m.gelo === 'INFINITO' ? 'Gelo Infinito' : 'Gelo Normal');
const LINK_REGRAS = 'https://discord.com/channels/1541905325895065671/1541922210028064798';

const STATUS = {
  AGUARDANDO_PAGAMENTO: { txt: '💳 AGUARDANDO PAGAMENTO DA PARTIDA', cor: cfg.COR.aviso },
  AGUARDANDO_REGRAS: { txt: '📝 AGUARDANDO COMBINAR REGRAS', cor: cfg.COR.aviso },
  REGRA_PROPOSTA: { txt: '📝 REGRA PROPOSTA · aguardando resposta', cor: cfg.COR.aviso },
  AGUARDANDO_SALA: { txt: '🎮 AGUARDANDO CRIAÇÃO DA SALA', cor: cfg.COR.primaria },
  EM_ANDAMENTO: { txt: '🔴 PARTIDA EM ANDAMENTO', cor: cfg.COR.primaria },
  AGUARDANDO_RECRIACAO: { txt: '🔄 RECRIANDO SALA · aguardando as duas taxas', cor: cfg.COR.aviso },
  REVISAO: { txt: '⚖️ EM REVISÃO · aguardando a staff decidir', cor: cfg.COR.erro },
  AGUARDANDO_RESULTADO: { txt: '⏳ AGUARDANDO CONFIRMAÇÃO DO ADVERSÁRIO', cor: cfg.COR.aviso },
  SS_SOLICITADO: { txt: '🎥 VAR ACIONADO PELA STAFF · aguardando análise', cor: cfg.COR.aviso },
  DISPUTA: { txt: '⚠️ EM DISPUTA · aguardando veredito da staff', cor: cfg.COR.erro },
  FINALIZADA: { txt: '✅ FINALIZADA', cor: cfg.COR.sucesso },
  CANCELADA: { txt: '🚫 CANCELADA', cor: cfg.COR.neutro },
};

// Cancelar so vale enquanto as regras nao foram aceitas. Depois disso a partida
// esta valendo e so a staff pode anular.
const PODE_CANCELAR = ['AGUARDANDO_PAGAMENTO', 'AGUARDANDO_REGRAS', 'REGRA_PROPOSTA'];

/** Quem ainda não garantiu o valor da partida. */
const devendo = (m) => [
  ...(m.pago_p1 ? [] : [m.p1]),
  ...(m.pago_p2 ? [] : [m.p2]),
];

const pagouTudo = (m) => !!m.pago_p1 && !!m.pago_p2;

const propostaRevanche = (id) => db.prepare(
  'SELECT * FROM revanche_propostas WHERE id = ?'
).get(id);

const revancheDaPartida = (matchId) => db.prepare(
  "SELECT * FROM revanche_propostas WHERE match_id = ? AND status IN ('PENDENTE', 'ACEITA') ORDER BY id DESC LIMIT 1"
).get(matchId);

const ehRevanche = (matchId) => db.prepare(
  "SELECT * FROM revanche_propostas WHERE new_match_id = ? AND status = 'ACEITA' LIMIT 1"
).get(matchId);

/** Resposta de erro padrão, sempre privada. */
const nao = (interaction, titulo, texto) => interaction.reply(ui.msg(
  ui.bloco(cfg.COR.erro, ui.titulo(`❌ ${titulo}`), ui.txt(texto)),
  { efemero: true },
));

/** Converte tanto o formato novo (ID do vencedor) quanto registros antigos. */
function vencedorEscolhido(m, jogadorId, escolha) {
  if (!escolha) return null;
  if (escolha === 'GANHEI') return jogadorId;
  if (escolha === 'PERDI') return oponente(m, jogadorId);
  return ehJogador(m, escolha) ? escolha : null;
}

const linhaEscolha = (m, jogadorId, escolha, emoji) => {
  const vencedor = vencedorEscolhido(m, jogadorId, escolha);
  return `${emoji} <@${jogadorId}> · ${vencedor ? `escolheu <@${vencedor}>` : '_ainda não escolheu_'}`;
};

/** Linha de escolhas usada em disputas e vereditos. */
const placar = (m) =>
  `${linhaEscolha(m, m.p1, m.claim_p1, '1️⃣')}\n` +
  `${linhaEscolha(m, m.p2, m.claim_p2, '2️⃣')}`;

/* ------------------------------------------------------------ PAINEL DO TICKET */

function painel(m, { bannerUrl = null } = {}) {
  const streak = require('./streak');
  const s = STATUS[m.status] || { txt: m.status, cor: cfg.COR.neutro };

  // Alguem em win streak jogando: ticket ganha destaque laranja e o 🔥N ao lado do nome.
  const tagP1 = streak.tagStreak(m.p1);
  const tagP2 = streak.tagStreak(m.p2);
  const temStreak = !!(tagP1 || tagP2);
  const cor = temStreak && !['FINALIZADA', 'CANCELADA'].includes(m.status) ? streak.COR_STREAK : s.cor;
  const confirmandoResultado = ['EM_ANDAMENTO', 'AGUARDANDO_RESULTADO'].includes(m.status);

  return ui.bloco(cor,
    ui.titulo(`⚔️ PARTIDA #${m.id} · ${m.modalidade}`),
    ui.nota(`${modo(m)} · ticket privado dos dois jogadores`),
    bannerUrl ? ui.imagem(bannerUrl) : null,
    ui.divisor(),
    ui.txt(`1️⃣ <@${m.p1}>${tagP1}\n**⚔️ VS**\n2️⃣ <@${m.p2}>${tagP2}`),
    ui.divisor(),
    ui.tabela([
      ['Valor por jogador', money.fmt(m.valor)],
      ['Premio ao vencedor', money.fmt(premio(m))],
      ['Taxa da organizacao', money.fmt(m.taxa)],
    ]),
    m.status === 'AGUARDANDO_PAGAMENTO' ? ui.divisor() : null,
    m.status === 'AGUARDANDO_PAGAMENTO' ? ui.secao('💳 Pagamento pendente') : null,
    m.status === 'AGUARDANDO_PAGAMENTO'
      ? ui.txt(
          `${devendo(m).map((id) => `⏳ <@${id}> ainda não pagou`).join('\n')}\n\n` +
          `Quem está devendo clica em **PAGAR MINHA PARTIDA** e paga ${money.fmt(m.valor)} no PIX. ` +
          `Sem os dois pagamentos a partida não começa — e ela é cancelada em ${cfg.pagamentoMinutos} minutos ` +
          'se alguém não pagar.'
        )
      : null,
    m.regras ? ui.secao('📜 Regras combinadas') : null,
    m.regras ? ui.txt('```\n' + m.regras.slice(0, 900) + '\n```') : null,
    m.status === 'AGUARDANDO_RECRIACAO' ? ui.secao('🔄 Taxa da nova sala') : null,
    m.status === 'AGUARDANDO_RECRIACAO' ? ui.txt(
      `${m.recriar_p1 ? '✅' : '⏳'} <@${m.p1}> · ${m.recriar_p1 ? 'pago' : 'aguardando pagamento'}\n` +
      `${m.recriar_p2 ? '✅' : '⏳'} <@${m.p2}> · ${m.recriar_p2 ? 'pago' : 'aguardando pagamento'}\n\n` +
      `Cada jogador paga **${money.fmt(taxaRecriacao())}**. A nova sala só é liberada quando os dois pagarem.`
    ) : null,
    confirmandoResultado ? ui.divisor() : null,
    confirmandoResultado ? ui.secao('🏁 QUEM VENCEU?') : null,
    confirmandoResultado ? ui.txt(
      'Quando a partida acabar, um jogador seleciona o vencedor no menu abaixo. ' +
      'O adversário receberá uma mensagem para **confirmar o resultado**.\n\n' +
      `${m.claim_p1 ? '✅' : '⏳'} <@${m.p1}> · ${m.claim_p1 ? 'respondeu' : 'aguardando'}\n` +
      `${m.claim_p2 ? '✅' : '⏳'} <@${m.p2}> · ${m.claim_p2 ? 'respondeu' : 'aguardando'}`
    ) : null,
    confirmandoResultado ? ui.nota(
      `Depois da primeira resposta, quem não confirmar em ${cfg.confirmacaoMinutos} minutos perde ${cfg.penalidadeNaoConfirmar} pontos.`
    ) : null,
    ui.divisor(true),
    ui.secao(s.txt),
    m.winner_id ? ui.txt(`🥇 Vencedor: <@${m.winner_id}>`) : null,
    ...botoes(m),
    ui.nota('O valor de cada jogador está reservado até o resultado sair.'),
  );
}

/** Monta o painel e, quando pedido, anexa a arte correspondente à modalidade. */
function mensagemPainel(m, { anexarBanner = false } = {}) {
  const banner = banners.obter(m.modalidade);
  return ui.msg(
    painel(m, { bannerUrl: banner?.url }),
    banner && anexarBanner
      ? { files: [{ attachment: banner.caminho, name: banner.nome }] }
      : {},
  );
}

/** Botões do painel, conforme a fase da partida. */
function seletorVencedor(m) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`match:winner:${m.id}`)
      .setPlaceholder('Quem venceu?')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        {
          label: 'Jogador 1',
          description: 'Selecionar o Jogador 1 como vencedor',
          value: m.p1,
          emoji: '1️⃣',
        },
        {
          label: 'Jogador 2',
          description: 'Selecionar o Jogador 2 como vencedor',
          value: m.p2,
          emoji: '2️⃣',
        },
      ),
  );
}

function botoes(m) {
  const botaoRegras = () => ui.botaoLink(LINK_REGRAS, 'REGRAS DO SERVIDOR', '📜');

  if (m.status === 'FINALIZADA' || m.status === 'CANCELADA') {
    return [ui.linhaBotoes(botaoRegras())];
  }

  const linha1 = [];
  if (m.status === 'AGUARDANDO_PAGAMENTO') {
    linha1.push(ui.botao(`match:pay:${m.id}`, 'PAGAR MINHA PARTIDA', { estilo: ui.ESTILO.Success, emoji: '💳' }));
  }
  if (m.status === 'AGUARDANDO_REGRAS') {
    linha1.push(ui.botao(`match:rules:${m.id}`, 'COMBINAR REGRAS', { estilo: ui.ESTILO.Primary, emoji: '📜' }));
  }
  if (m.status === 'AGUARDANDO_SALA') {
    linha1.push(ui.botao(`match:room:${m.id}`, 'SALA CRIADA · INICIAR', { estilo: ui.ESTILO.Success, emoji: '🎮' }));
  }
  if (m.status === 'AGUARDANDO_RECRIACAO') {
    linha1.push(ui.botao(`match:recriar:${m.id}`, 'RECRIAR SALA', { estilo: ui.ESTILO.Primary, emoji: '🔄' }));
  }
  const confirmandoResultado = ['EM_ANDAMENTO', 'AGUARDANDO_RESULTADO'].includes(m.status);

  const linha2 = [];
  if (PODE_CANCELAR.includes(m.status)) {
    linha2.push(ui.botao(`match:cancel:${m.id}`, 'CANCELAR', { estilo: ui.ESTILO.Danger, emoji: '🚫' }));
  }
  if (!['DISPUTA', 'SS_SOLICITADO', 'REVISAO'].includes(m.status)) {
    linha2.push(ui.botao(`match:support:${m.id}`, 'CHAMAR SUPORTE', { estilo: ui.ESTILO.Danger, emoji: '🆘' }));
  }
  linha2.push(botaoRegras());

  // Linha sem botão é rejeitada pelo Discord.
  return [
    ...[linha1].filter((l) => l.length).map((l) => ui.linhaBotoes(...l)),
    confirmandoResultado ? seletorVencedor(m) : null,
    ...[linha2].filter((l) => l.length).map((l) => ui.linhaBotoes(...l)),
  ].filter(Boolean);
}

/**
 * Reescreve a mensagem principal do ticket.
 *
 * Guardamos o id do painel em `painel_msg_id`: com ele a edicao e UMA chamada.
 * Antes isso buscava as mensagens fixadas toda vez, o que custava 2 chamadas
 * extras a cada mudanca de status — em pico de partidas isso pesa muito.
 */
async function atualizarPainel(client, matchId) {
  const m = get(matchId);
  if (!m || !m.thread_id) return;

  try {
    const thread = await client.channels.fetch(m.thread_id);
    // O banner ja foi anexado quando o painel nasceu; reeditar nao precisa reenviar.
    const carga = mensagemPainel(m, { anexarBanner: false });

    if (m.painel_msg_id) {
      await thread.messages.edit(m.painel_msg_id, carga);
      return;
    }

    // Partida antiga, de antes da coluna existir: acha uma vez e guarda o id.
    const pins = await thread.messages.fetchPinned();
    const alvo = pins.find((msg) => msg.author.id === client.user.id);
    if (!alvo) return;

    db.prepare('UPDATE matches SET painel_msg_id = ? WHERE id = ?').run(alvo.id, matchId);
    await alvo.edit(carga);
  } catch (e) {
    console.warn(`[partida #${matchId}] falha ao atualizar painel:`, e.message);
  }
}

/* -------------------------------------------------------------- ABRIR TICKET */

async function abrirTicket(client, matchId) {
  const m = get(matchId);
  if (!m) return null;

  const canal = await gc.channel(client, m.guild_id, 'canal_tickets');
  if (!canal) {
    console.error('[partida] canal_tickets nao configurado — use /config canal canal_tickets');
    return null;
  }

  const thread = await canal.threads.create({
    name: `⚔ ${m.modalidade} · ${money.fmt(m.valor)} · #${m.id}`.slice(0, 100),
    autoArchiveDuration: 1440,
    type: ChannelType.PrivateThread,
    invitable: false,
    reason: `Partida #${m.id}`,
  });

  db.prepare('UPDATE matches SET thread_id = ? WHERE id = ?').run(thread.id, matchId);

  await thread.members.add(m.p1).catch(() => {});
  await thread.members.add(m.p2).catch(() => {});

  const atualizado = get(matchId);
  const msgPainel = await thread.send(mensagemPainel(atualizado, { anexarBanner: true }));
  // Guarda o id para as proximas edicoes nao precisarem varrer as fixadas.
  db.prepare('UPDATE matches SET painel_msg_id = ? WHERE id = ?').run(msgPainel.id, matchId);
  await msgPainel.pin().catch(() => {});

  await thread.send(ui.msg(ui.bloco(cfg.COR.neutro,
    ui.titulo('ℹ️ COMO FUNCIONA'),
    ui.divisor(),
    ui.txt(
      '**1 ·** Alguém clica em `COMBINAR REGRAS` e escreve as regras do confronto.\n' +
      '**2 ·** O adversário `CONFIRMA` ou usa `MUDAR REGRA` para propor outra.\n' +
      '**3 ·** Regras aceitas → status vira **AGUARDANDO CRIAÇÃO DA SALA**.\n' +
      '**4 ·** No fim, um jogador seleciona **quem venceu** no painel da partida.\n' +
      '**5 ·** O adversário confirma o vencedor. Se discordar ou der problema, use `CHAMAR SUPORTE`.'
    ),
    ui.divisor(),
    ui.txt(
      '🆘 **CHAMAR SUPORTE** funciona como SOS em qualquer fase ativa da partida.\n' +
      '🎥 Se o caso precisar de VAR, somente a staff poderá encaminhá-lo para análise.\n' +
      '🔒 Depois das regras aceitas, **só a staff pode anular**.'
    ),
  )));

  // Quem entrou na fila sem saldo paga essa partida aqui dentro.
  if (atualizado.status === 'AGUARDANDO_PAGAMENTO') {
    await cobrancaNoTicket(thread, atualizado);
  }

  await avisarNoPv(client, get(matchId), thread);
  return thread;
}

/** Aviso de cobrança dentro do ticket, marcando quem está devendo. */
async function cobrancaNoTicket(thread, m) {
  const devedores = devendo(m);
  const prazo = Math.floor((Date.now() + cfg.pagamentoMinutos * 60_000) / 1000);

  await thread.send(ui.msg(ui.bloco(cfg.COR.aviso,
    ui.titulo('💳 PAGAMENTO DA PARTIDA'),
    ui.nota(`Partida #${m.id} · prazo até <t:${prazo}:t>`),
    ui.divisor(),
    ui.txt(
      `${devedores.map((id) => `<@${id}>`).join(' e ')} entrou na fila **sem saldo**.\n\n` +
      `Clique no botão abaixo e pague **${money.fmt(m.valor)}** no PIX. ` +
      'Esse valor vale **só para esta partida** — não entra como saldo na conta.'
    ),
    ui.divisor(),
    ui.tabela([
      ['Valor a pagar', money.fmt(m.valor)],
      ['Premio se vencer', money.fmt(premio(m))],
      ['Prazo', `${cfg.pagamentoMinutos} minutos`],
    ]),
    ui.linhaBotoes(
      ui.botao(`match:pay:${m.id}`, 'PAGAR MINHA PARTIDA', { estilo: ui.ESTILO.Success, emoji: '💳' }),
    ),
    ui.nota('Não pagou no prazo? A partida é cancelada e quem pagou recebe de volta.'),
  )));
}

/**
 * Registra que um jogador garantiu o valor da partida (pagou direto no ticket).
 * O dinheiro entra e já vai para reservado — nunca fica disponível como saldo.
 */
const marcarPago = db.transaction((matchId, userId, viaSaldo) => {
  const m = get(matchId);
  if (!m || !ehJogador(m, userId)) return null;

  const campo = m.p1 === userId ? 'pago_p1' : 'pago_p2';
  if (m[campo]) return { jaPago: true, match: m };

  // Pagou por PIX: o dinheiro entra e já vai para reservado, sem virar saldo livre.
  if (!viaSaldo) {
    wallet.credit(userId, m.valor, 'DEPOSITO', `Pagamento da partida #${matchId}`, `match:${matchId}`);
  }
  wallet.lock(userId, m.valor);
  db.prepare(`UPDATE matches SET ${campo} = 1 WHERE id = ?`).run(matchId);

  const atual = get(matchId);
  if (pagouTudo(atual) && atual.status === 'AGUARDANDO_PAGAMENTO') {
    // Revanche já reaproveita as regras combinadas e começa assim que os dois
    // valores estiverem garantidos. Partida comum segue pelo acordo de regras.
    setStatus(matchId, ehRevanche(matchId) ? 'EM_ANDAMENTO' : 'AGUARDANDO_REGRAS');
  }
  return { jaPago: false, match: get(matchId) };
});

/** Chamado pelo webhook do PIX ou pelo botão "Já paguei". */
const registrarPagamento = (client, matchId, userId, amount) =>
  anunciarPagamento(client, marcarPago(matchId, userId, false), userId, amount);

/** Jogador que depositou depois e agora paga a partida com o próprio saldo. */
const registrarPagamentoPorSaldo = (client, matchId, userId, amount) =>
  anunciarPagamento(client, marcarPago(matchId, userId, true), userId, amount);

async function anunciarPagamento(client, r, userId, amount) {
  if (!r || r.jaPago) return r;

  const m = r.match;
  const thread = await client.channels.fetch(m.thread_id).catch(() => null);

  if (thread) {
    const revanche = ehRevanche(m.id);
    await thread.send(ui.msg(ui.bloco(cfg.COR.sucesso,
      ui.titulo('✅ PAGAMENTO CONFIRMADO'),
      ui.txt(`<@${userId}> pagou **${money.fmt(amount)}** e está dentro.`),
      ui.divisor(),
      pagouTudo(m)
        ? ui.txt(revanche
          ? 'Os dois valores estão garantidos. **A revanche começou!**'
          : 'Os dois valores estão garantidos. **Podem combinar as regras.**')
        : ui.txt(`Ainda falta ${devendo(m).map((id) => `<@${id}>`).join(' e ')} pagar.`),
    )));

    if (pagouTudo(m) && revanche) {
      await thread.send(ui.msg(painelSuporte(m))).catch(() => {});
    }
  }

  await atualizarPainel(client, m.id);
  return r;
}

/** Chama os dois jogadores no privado com um botao que leva direto ao ticket. */
async function avisarNoPv(client, m, thread) {
  const link = notificar.linkPara(m.guild_id, thread.id);
  const revanche = !!ehRevanche(m.id);

  for (const jogadorId of [m.p1, m.p2]) {
    const adv = oponente(m, jogadorId);
    try {
      const user = await client.users.fetch(jogadorId);
      await user.send(ui.msg(ui.bloco(cfg.COR.primaria,
        ui.titulo(revanche ? '🔁 REVANCHE ACEITA!' : '🎮 PARTIDA ENCONTRADA!'),
        ui.nota(`${m.modalidade} · ${modo(m)}`),
        ui.divisor(),
        ui.txt(`Seu adversário: <@${adv}>`),
        ui.tabela([
          ['Valor da partida', money.fmt(m.valor)],
          ['Premio se voce vencer', money.fmt(premio(m))],
        ]),
        ui.divisor(),
        ui.comBotao(
          m.status === 'AGUARDANDO_PAGAMENTO'
            ? '**Entre no ticket** para concluir o pagamento da partida.'
            : revanche
              ? '**Entre no ticket** — a revanche já começou.'
              : '**Entre no ticket** para combinar as regras e começar.',
          ui.botaoLink(link, 'IR PARA O TICKET', '⚔️'),
        ),
        ui.nota(`Partida #${m.id}`),
      )));
    } catch {
      // DM fechada: avisa no proprio ticket para o jogador nao ficar perdido.
      await thread.send(ui.msg(ui.bloco(cfg.COR.aviso,
        ui.txt(`⚠️ <@${jogadorId}>, não consegui te chamar no privado (DM fechada). Fique de olho aqui no ticket.`),
      ))).catch(() => {});
    }
  }
}

/* -------------------------------------------------------------------- REGRAS */

const modalRegras = (matchId, id = 'match:rules_modal') =>
  new ModalBuilder().setCustomId(`${id}:${matchId}`).setTitle('Regras do confronto')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('regras').setLabel('Escreva as regras da partida')
        .setPlaceholder('Ex: Sem carro, sem granada, mapa Bermuda, melhor de 3...')
        .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(900)));

async function proporRegras(interaction, matchId, { mudanca = false } = {}) {
  const m = get(matchId);
  if (!m) return nao(interaction, 'Partida não encontrada', 'Esse ticket não corresponde a nenhuma partida.');
  if (!ehJogador(m, interaction.user.id)) {
    return nao(interaction, 'Você não é jogador', 'Só os jogadores dessa partida podem combinar as regras.');
  }
  if (!['AGUARDANDO_REGRAS', 'REGRA_PROPOSTA'].includes(m.status)) {
    return nao(interaction, 'Regras já definidas', 'As regras dessa partida já foram aceitas.');
  }

  const regras = interaction.fields.getTextInputValue('regras').trim();
  db.prepare("UPDATE matches SET regras = ?, regras_autor = ?, status = 'REGRA_PROPOSTA' WHERE id = ?")
    .run(regras, interaction.user.id, matchId);

  const adv = oponente(m, interaction.user.id);

  await interaction.reply(ui.msg(ui.bloco(cfg.COR.aviso,
    ui.titulo(mudanca ? '📜 NOVA REGRA PROPOSTA' : '📜 REGRAS PROPOSTAS'),
    ui.nota(`Partida #${matchId}`),
    ui.divisor(),
    ui.txt(`<@${interaction.user.id}> propôs:`),
    ui.txt('```\n' + regras + '\n```'),
    ui.divisor(),
    ui.txt(`<@${adv}>, você aceita essas regras?`),
    ui.linhaBotoes(
      ui.botao(`match:rules_confirm:${matchId}`, 'CONFIRMAR', { estilo: ui.ESTILO.Success, emoji: '✅' }),
      ui.botao(`match:rules_change:${matchId}`, 'MUDAR REGRA', { estilo: ui.ESTILO.Primary, emoji: '✏️' }),
      mudanca ? ui.botao(`match:rules_refuse:${matchId}`, 'RECUSAR', { estilo: ui.ESTILO.Danger, emoji: '❌' }) : null,
    ),
  )));

  await atualizarPainel(interaction.client, matchId);
}

async function confirmarRegras(interaction, matchId) {
  const m = get(matchId);
  if (!m) return nao(interaction, 'Partida não encontrada', 'Esse ticket não corresponde a nenhuma partida.');
  if (!ehJogador(m, interaction.user.id)) {
    return nao(interaction, 'Você não é jogador', 'Só os jogadores dessa partida podem responder.');
  }
  if (m.regras_autor === interaction.user.id) {
    return nao(interaction, 'Espere o adversário', 'Quem propôs a regra não pode confirmá-la.');
  }
  if (m.status !== 'REGRA_PROPOSTA') {
    return nao(interaction, 'Nada para confirmar', 'Não há regra pendente de confirmação.');
  }

  setStatus(matchId, 'AGUARDANDO_SALA');

  // Mensagem V2 é reescrita inteira: mantém o registro e remove os botões.
  await interaction.update(ui.msg(ui.bloco(cfg.COR.sucesso,
    ui.titulo('✅ REGRAS ACEITAS'),
    ui.nota(`Partida #${matchId}`),
    ui.divisor(),
    ui.txt(`Propostas por <@${m.regras_autor}> e aceitas por <@${interaction.user.id}>.`),
    ui.txt('```\n' + (m.regras || '').slice(0, 900) + '\n```'),
    ui.divisor(),
    ui.secao('🎮 AGUARDANDO CRIAÇÃO DA SALA'),
    ui.txt(
      'Criem a sala, mandem o código aqui e cliquem em `SALA CRIADA · INICIAR` ao começar.\n\n' +
      '🔒 A partida **está valendo**: o botão de cancelar sumiu e só a staff pode anular.'
    ),
  )));

  await atualizarPainel(interaction.client, matchId);
}

async function recusarRegras(interaction, matchId) {
  const m = get(matchId);
  if (!m) return nao(interaction, 'Partida não encontrada', 'Esse ticket não corresponde a nenhuma partida.');
  if (!ehJogador(m, interaction.user.id)) {
    return nao(interaction, 'Você não é jogador', 'Só os jogadores dessa partida podem responder.');
  }
  if (m.regras_autor === interaction.user.id) {
    return nao(interaction, 'Espere o adversário', 'Você propôs essa regra — quem recusa é o adversário.');
  }

  await interaction.update(ui.msg(ui.bloco(cfg.COR.neutro,
    ui.titulo('❌ REGRAS RECUSADAS'),
    ui.txt(`<@${interaction.user.id}> recusou as regras. A partida vai ser cancelada e o valor devolvido.`),
  )));
  await cancelarPartida(interaction.client, matchId, `Regras recusadas por <@${interaction.user.id}>`);
}

/* ------------------------------------------------------------------ SALA/JOGO */

async function iniciarPartida(interaction, matchId) {
  const m = get(matchId);
  if (!m) return nao(interaction, 'Partida não encontrada', 'Esse ticket não corresponde a nenhuma partida.');
  // Os dois jogadores podem iniciar, e a staff tambem (para destravar ticket parado).
  if (!ehJogador(m, interaction.user.id) && !gc.hasRole(interaction.member, 'cargo_staff')) {
    return nao(interaction, 'Você não é jogador', 'Só os jogadores ou a staff podem iniciar.');
  }
  if (m.status !== 'AGUARDANDO_SALA') {
    return nao(interaction, 'Fora de hora', 'A partida não está aguardando a criação da sala.');
  }

  setStatus(matchId, 'EM_ANDAMENTO');

  await interaction.reply(ui.msg(ui.bloco(cfg.COR.primaria,
    ui.titulo('🔴 PARTIDA INICIADA'),
    ui.nota(`Partida #${matchId} · iniciada por ${interaction.user}`),
    ui.divisor(),
    ui.txt(
      'Boa sorte!\n\n' +
      '🏁 Quando acabar, **um jogador seleciona quem venceu no painel da partida** e o adversário confirma. ' +
      'Se houver qualquer problema, use **CHAMAR SUPORTE**.'
    ),
  )));

  // Fica no ticket durante a partida como um SOS permanente para os jogadores.
  await interaction.channel.send(ui.msg(painelSuporte(get(matchId)))).catch(() => {});

  await atualizarPainel(interaction.client, matchId);
}

/* --------------------------------------------------------- QUEBRA DE REGRA */

/** Cada jogador paga metade da taxa para refazer a sala. */
const taxaRecriacao = () => Math.ceil(cfg.taxaPartida / 2);

/** Bloco SOS fixo que fica no ticket durante a partida. */
const painelSuporte = (m) => ui.bloco(cfg.COR.erro,
  ui.titulo('🆘 PRECISA DE AJUDA?'),
  ui.nota(`Partida #${m.id}`),
  ui.divisor(),
  ui.txt(
    'Deu algum problema com pagamento, regras, sala, resultado ou comportamento?\n\n' +
    'Clique em **CHAMAR SUPORTE** para enviar um SOS à equipe. A staff entra no ticket ' +
    'e, se for necessário analisar tela/replay, ela mesma encaminha o caso para o VAR.'
  ),
  ui.linhaBotoes(
    ui.botao(`match:support:${m.id}`, 'CHAMAR SUPORTE', { estilo: ui.ESTILO.Danger, emoji: '🆘' }),
  ),
  ui.nota('O botão é para urgências da partida e pode ser usado em qualquer fase ativa.'),
);

const modalQuebra = (matchId) =>
  new ModalBuilder().setCustomId(`match:quebra_modal:${matchId}`).setTitle('Quebra de regra')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('texto')
        .setLabel('Quais regras foram quebradas?')
        .setPlaceholder('Ex: usou carro depois de combinar sem carro, no round 2...')
        .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(900)));

async function abrirQuebraDeRegra(interaction, matchId) {
  const m = get(matchId);
  if (!m) return nao(interaction, 'Partida não encontrada', 'Esse ticket não corresponde a nenhuma partida.');
  if (!ehJogador(m, interaction.user.id)) {
    return nao(interaction, 'Você não é jogador', 'Só os jogadores dessa partida podem denunciar.');
  }
  if (m.status !== 'EM_ANDAMENTO') {
    return nao(interaction, 'Fora de hora', 'A quebra de regra só pode ser relatada enquanto a partida está em andamento.');
  }
  return interaction.showModal(modalQuebra(matchId));
}

/** Registra a denúncia, marca o acusado e manda os dois se resolverem. */
async function registrarQuebra(interaction, matchId) {
  const m = get(matchId);
  if (!m) return nao(interaction, 'Partida não encontrada', 'Esse ticket não corresponde a nenhuma partida.');
  if (!ehJogador(m, interaction.user.id)) {
    return nao(interaction, 'Você não é jogador', 'Só os jogadores dessa partida podem denunciar.');
  }
  if (m.status !== 'EM_ANDAMENTO') {
    return nao(interaction, 'Fora de hora', 'A partida não está mais em andamento e essa denúncia não foi registrada.');
  }

  const texto = interaction.fields.getTextInputValue('texto').trim();
  const lesado = interaction.user.id;
  const acusado = oponente(m, lesado);

  db.prepare('INSERT INTO denuncias (match_id, autor, acusado, texto, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(matchId, lesado, acusado, texto, Date.now());

  await interaction.reply(ui.msg(ui.bloco(cfg.COR.erro,
    ui.titulo('⚠️ QUEBRA DE REGRA RELATADA'),
    ui.nota(`Partida #${matchId} · ${m.modalidade}`),
    ui.divisor(),
    ui.txt(`🙋 **Lesado:** <@${lesado}>\n🚩 **Denunciado:** <@${acusado}>`),
    ui.secao('📄 O que foi relatado'),
    ui.txt('```\n' + texto + '\n```'),
    ui.divisor(),
    ui.secao('📜 Regras combinadas'),
    ui.txt(m.regras ? '```\n' + m.regras.slice(0, 700) + '\n```' : '_nenhuma regra registrada no ticket_'),
  )));

  await interaction.channel.send(ui.msg(ui.bloco(cfg.COR.aviso,
    ui.titulo('🤝 RESOLVAM ENTRE VOCÊS'),
    ui.divisor(),
    ui.txt(
      `<@${lesado}> <@${acusado}>\n\n` +
      'Conversem aqui e cheguem a um acordo: entregar o round, refazer a rodada, ' +
      'seguir o jogo normalmente — o que os dois aceitarem.\n\n' +
      'Se **não** chegarem a um acordo nesta partida, usem o botão abaixo para **refazer a sala**.'
    ),
    ui.divisor(),
    ui.tabela([
      ['Custo para refazer', money.fmt(taxaRecriacao()) + ' por jogador'],
      ['Salas ja refeitas', String(m.recriacoes || 0)],
    ]),
    ui.linhaBotoes(
      ui.botao(`match:recriar:${matchId}`, 'RECRIAR SALA', { estilo: ui.ESTILO.Primary, emoji: '🔄' }),
      ui.botao(`match:revisao:${matchId}`, 'PEDIR REVISÃO', { estilo: ui.ESTILO.Danger, emoji: '⚖️' }),
    ),
    ui.nota('PEDIR REVISÃO chama a staff para decidir o caso. Tela (SS) só no fim da partida.'),
  )));

  // Espelha a denuncia em um canal da staff, sem tirar a conversa do ticket.
  const canalQuebra = await gc.channel(interaction.client, m.guild_id, 'canal_quebra_regra');
  if (canalQuebra && canalQuebra.id !== interaction.channel.id) {
    const cargoStaff = gc.get(m.guild_id, 'cargo_staff');
    await canalQuebra.send(ui.msg(ui.bloco(cfg.COR.erro,
      ui.titulo('⚠️ NOVA QUEBRA DE REGRA'),
      ui.nota(`Partida #${matchId} · ${m.modalidade}`),
      ui.divisor(),
      ui.txt(`${cargoStaff ? `<@&${cargoStaff}>\n\n` : ''}🙋 **Lesado:** <@${lesado}>\n🚩 **Denunciado:** <@${acusado}>`),
      ui.secao('📄 O que foi relatado'),
      ui.txt('```\n' + texto.slice(0, 900) + '\n```'),
      m.regras ? ui.secao('📜 Regras combinadas') : null,
      m.regras ? ui.txt('```\n' + m.regras.slice(0, 700) + '\n```') : null,
      ui.comBotao(
        '**Acompanhar e intervir no ticket**',
        ui.botaoLink(notificar.linkPara(m.guild_id, m.thread_id), 'ABRIR TICKET', '⚔️'),
      ),
    ))).catch((e) => console.error(`[quebra #${matchId}] falha ao espelhar denuncia:`, e.message));
  }

  await atualizarPainel(interaction.client, matchId);
}

/**
 * Refazer a sala: cada jogador paga metade da taxa do próprio saldo.
 * A partida só volta para AGUARDANDO SALA quando os dois pagarem.
 */
const cobrarRecriacao = db.transaction((matchId, userId) => {
  const m = get(matchId);
  if (!m || !ehJogador(m, userId)) return { erro: 'NAO_E_JOGADOR' };
  if (['FINALIZADA', 'CANCELADA'].includes(m.status)) return { erro: 'ENCERRADA' };
  if (!['EM_ANDAMENTO', 'AGUARDANDO_RECRIACAO'].includes(m.status)) return { erro: 'FORA_DE_HORA' };

  const denuncia = db.prepare('SELECT 1 FROM denuncias WHERE match_id = ? LIMIT 1').get(matchId);
  if (!denuncia) return { erro: 'SEM_DENUNCIA' };

  const campo = m.p1 === userId ? 'recriar_p1' : 'recriar_p2';
  if (m[campo]) return { erro: 'JA_PAGOU' };

  const custo = taxaRecriacao();
  try {
    wallet.debit(userId, custo, 'TAXA', `Recriação de sala da partida #${matchId}`, `match:${matchId}`);
  } catch {
    return { erro: 'SEM_SALDO', saldo: wallet.getBalance(userId), custo };
  }

  db.prepare(`UPDATE matches SET ${campo} = 1, status = 'AGUARDANDO_RECRIACAO' WHERE id = ?`).run(matchId);
  const atual = get(matchId);
  const ambos = atual.recriar_p1 && atual.recriar_p2;

  if (ambos) {
    db.prepare(
      `UPDATE matches SET status = 'AGUARDANDO_SALA', recriacoes = recriacoes + 1,
       recriar_p1 = 0, recriar_p2 = 0, claim_p1 = NULL, claim_p2 = NULL,
       proof_p1 = NULL, proof_p2 = NULL, ss_por = NULL, ss_nicks = NULL,
       staff_id = NULL, cancel_req = NULL WHERE id = ?`
    ).run(matchId);
  }
  return { ok: true, ambos, custo, match: get(matchId) };
});

async function recriarSala(interaction, matchId) {
  const r = cobrarRecriacao(matchId, interaction.user.id);

  if (r.erro === 'NAO_E_JOGADOR') return nao(interaction, 'Você não é jogador', 'Só os jogadores podem refazer a sala.');
  if (r.erro === 'ENCERRADA') return nao(interaction, 'Partida encerrada', 'Essa partida já foi finalizada ou cancelada.');
  if (r.erro === 'FORA_DE_HORA') return nao(interaction, 'Fora de hora', 'A sala não pode ser recriada no estado atual da partida.');
  if (r.erro === 'SEM_DENUNCIA') return nao(interaction, 'Sem quebra registrada', 'Relate primeiro a quebra de regra antes de pedir uma nova sala.');
  if (r.erro === 'JA_PAGOU') return nao(interaction, 'Você já pagou', 'Aguardando o adversário pagar a parte dele.');
  if (r.erro === 'SEM_SALDO') {
    return interaction.reply(ui.msg(ui.bloco(cfg.COR.erro,
      ui.titulo('❌ SALDO INSUFICIENTE'),
      ui.txt(`Refazer a sala custa **${money.fmt(r.custo)}** e você tem **${money.fmt(r.saldo)}**.`),
      ui.linhaBotoes(ui.botao('wallet:deposit', 'DEPOSITAR', { estilo: ui.ESTILO.Success, emoji: '📥' })),
    ), { efemero: true }));
  }
  if (!r.ok) return nao(interaction, 'Não consegui processar', 'Tente de novo em instantes.');

  const m = r.match;
  const adv = oponente(m, interaction.user.id);

  await interaction.reply(ui.msg(ui.bloco(r.ambos ? cfg.COR.sucesso : cfg.COR.aviso,
    ui.titulo(r.ambos ? '🔄 SALA LIBERADA PARA REFAZER' : '💸 TAXA PAGA'),
    ui.nota(`Partida #${matchId}`),
    ui.divisor(),
    r.ambos
      ? ui.txt(
          `Os dois pagaram **${money.fmt(r.custo)}**. Criem a sala de novo e cliquem em ` +
          '`SALA CRIADA · INICIAR` quando começarem.\n\n' +
          'As escolhas de vencedor anteriores foram zeradas.'
        )
      : ui.txt(`<@${interaction.user.id}> pagou **${money.fmt(r.custo)}**.\n<@${adv}>, falta você para refazer a sala.`),
    ui.tabela([['Salas refeitas', String(m.recriacoes)]]),
  )));

  await atualizarPainel(interaction.client, matchId);
}

/**
 * Chama a staff para decidir um caso no MEIO da partida (quebra de regra).
 * Diferente do SS, que é só no fim: aqui o jogo pode continuar, mas a staff
 * já entra com poder de veredito sobre o caso.
 */
async function pedirRevisao(interaction, matchId) {
  const m = get(matchId);
  if (!m) return nao(interaction, 'Partida não encontrada', 'Esse ticket não corresponde a nenhuma partida.');
  if (!ehJogador(m, interaction.user.id)) {
    return nao(interaction, 'Você não é jogador', 'Só os jogadores dessa partida podem pedir revisão.');
  }
  if (m.status !== 'EM_ANDAMENTO') {
    return nao(interaction, 'Fora de hora', 'A revisão de quebra de regra só pode ser pedida durante a partida, antes de iniciar uma recriação.');
  }

  const denuncia = db.prepare(
    'SELECT * FROM denuncias WHERE match_id = ? ORDER BY id DESC LIMIT 1'
  ).get(matchId);
  if (!denuncia) return nao(interaction, 'Sem quebra registrada', 'Relate primeiro a quebra de regra antes de pedir revisão.');

  setStatus(matchId, 'REVISAO');

  const cargoStaff = gc.get(m.guild_id, 'cargo_staff');
  const adv = oponente(m, interaction.user.id);
  await interaction.reply(ui.msg(ui.bloco(cfg.COR.erro,
    ui.titulo('⚖️ REVISÃO SOLICITADA'),
    ui.nota(`Partida #${matchId} · ${m.modalidade} · ${money.fmt(m.valor)}`),
    ui.divisor(),
    ui.txt(`${cargoStaff ? `<@&${cargoStaff}>\n\n` : ''}<@${interaction.user.id}> pediu revisão contra <@${adv}>.`),
    denuncia ? ui.secao('📄 Quebra de regra relatada') : null,
    denuncia ? ui.txt('```\n' + denuncia.texto.slice(0, 700) + '\n```') : null,
    m.regras ? ui.secao('📜 Regras combinadas') : null,
    m.regras ? ui.txt('```\n' + m.regras.slice(0, 500) + '\n```') : null,
    ui.divisor(),
    ui.txt(
      '⚠️ O valor dos dois fica **travado** até a staff decidir.\n' +
      'Jogadores: mandem prints e provas aqui abaixo.'
    ),
    await botoesVeredito(interaction.client, m),
  )));

  await notificar.chamarCargo(interaction.client, m.guild_id, 'cargo_staff', {
    titulo: '⚖️ REVISÃO SOLICITADA',
    descricao:
      `**Partida #${m.id}** — quebra de regra no meio da partida.\n\n` +
      `Solicitante: <@${interaction.user.id}>\nAcusado: <@${adv}>` +
      (denuncia ? `\n\n**Relato:** ${denuncia.texto.slice(0, 300)}` : ''),
    dados: [
      ['Modalidade', m.modalidade],
      ['Valor por jogador', money.fmt(m.valor)],
      ['Premio em disputa', money.fmt(premio(m))],
    ],
    canalId: m.thread_id,
    rotuloBotao: 'IR PARA O TICKET',
    cor: cfg.COR.erro,
  });

  const canalRevisao = await gc.channel(interaction.client, m.guild_id, 'canal_quebra_regra')
    || await gc.channel(interaction.client, m.guild_id, 'canal_ss');
  if (canalRevisao) {
    await canalRevisao.send(ui.msg(ui.bloco(cfg.COR.erro,
      ui.titulo('⚖️ NOVA REVISÃO'),
      ui.txt(`${cargoStaff ? `<@&${cargoStaff}> · ` : ''}Partida #${m.id}`),
      ui.divisor(),
      ui.tabela([
        ['Modalidade', m.modalidade],
        ['Valor por jogador', money.fmt(m.valor)],
      ]),
      ui.txt(`Solicitante: <@${interaction.user.id}>\nAcusado: <@${adv}>`),
      ui.comBotao(
        '**Ticket da partida**',
        ui.botaoLink(notificar.linkPara(m.guild_id, m.thread_id), 'ABRIR TICKET', '⚔️'),
      ),
    ))).catch(() => {});
  }

  await atualizarPainel(interaction.client, matchId);
}

/* ---------------------------------------------------------------- RESULTADO */

/** Retorna o vencedor quando as duas declarações concordam. */
function vencedorPelosClaims(m) {
  const escolhidoP1 = vencedorEscolhido(m, m.p1, m.claim_p1);
  const escolhidoP2 = vencedorEscolhido(m, m.p2, m.claim_p2);
  return escolhidoP1 && escolhidoP1 === escolhidoP2 ? escolhidoP1 : null;
}

/**
 * Resolve partidas em que UM jogador declarou o resultado e o outro sumiu.
 *
 * Sem isso o ticket fica preso para sempre e os dois ficam com saldo travado —
 * ou seja, quem some acaba punindo o adversario. Passado o prazo, vale a unica
 * escolha registrada e quem nao confirmou perde pontos de elo.
 */
async function resolverAbandonos(client) {
  const limite = Date.now() - cfg.confirmacaoMinutos * 60 * 1000;

  // Exatamente UM dos dois declarou (o XOR), e o prazo ja venceu.
  const abandonadas = db.prepare(
    `SELECT * FROM matches
     WHERE status = 'AGUARDANDO_RESULTADO'
       AND claim_em IS NOT NULL AND claim_em < ?
       AND ((claim_p1 IS NULL) <> (claim_p2 IS NULL))`
  ).all(limite);

  let resolvidas = 0;

  for (const m of abandonadas) {
    try {
      const declarante = m.claim_p1 ? m.p1 : m.p2;
      const sumiu = oponente(m, declarante);
      const declarado = m.claim_p1 || m.claim_p2;
      const vencedor = vencedorEscolhido(m, declarante, declarado);

      if (!vencedor) {
        await abrirDisputa(client, m.id, 'A única escolha registrada era inválida e precisa ser analisada pela staff');
        continue;
      }

      const thread = await client.channels.fetch(m.thread_id).catch(() => null);
      if (thread) {
        await thread.send(ui.msg(ui.bloco(cfg.COR.aviso,
          ui.titulo('⏱️ PRAZO DE CONFIRMAÇÃO ESGOTADO'),
          ui.nota(`Partida #${m.id}`),
          ui.divisor(),
          ui.txt(
            `<@${sumiu}> não confirmou o resultado em **${cfg.confirmacaoMinutos} minutos**.\n\n` +
            `Vale a escolha registrada por <@${declarante}>: o vencedor é <@${vencedor}>.`
          ),
          ui.divisor(),
          ui.txt(`⚠️ <@${sumiu}> perde **${cfg.penalidadeNaoConfirmar} pontos** de elo por não confirmar.`),
        ))).catch(() => {});
      }

      await finalizarPartida(client, m.id, vencedor,
        `Confirmação automática — <@${sumiu}> não respondeu em ${cfg.confirmacaoMinutos} min`);

      // Penalidade so depois de finalizar de verdade: se o pagamento falhar,
      // ninguem e punido por um erro do bot.
      if (get(m.id)?.status === 'FINALIZADA') {
        const elo = require('./elo');
        await elo.registrar(client, m.guild_id, sumiu, -cfg.penalidadeNaoConfirmar,
          `Não confirmou o resultado da partida #${m.id}`, `match:${m.id}`);
        resolvidas += 1;
      }
    } catch (e) {
      console.error(`[abandono #${m.id}] falha ao resolver:`, e.message);
    }
  }

  return { verificadas: abandonadas.length, resolvidas };
}

/**
 * Recupera partidas em que o bot caiu depois de salvar o segundo resultado,
 * mas antes de pagar/finalizar. pagarVencedor é transacional e a FINALIZADA é
 * ignorada nas próximas execuções, então a recuperação não duplica prêmio.
 */
async function recuperarResultadosPendentes(client) {
  const pendentes = db.prepare(
    `SELECT * FROM matches
     WHERE status = 'AGUARDANDO_RESULTADO'
       AND claim_p1 IS NOT NULL AND claim_p2 IS NOT NULL`
  ).all();

  let finalizadas = 0;
  let disputas = 0;
  let erros = 0;

  for (const m of pendentes) {
    try {
      const vencedor = vencedorPelosClaims(m);
      if (vencedor) {
        await finalizarPartida(client, m.id, vencedor, 'Resultado recuperado automaticamente após interrupção do bot');
        if (get(m.id)?.status === 'FINALIZADA') finalizadas += 1;
      } else {
        await abrirDisputa(client, m.id, 'Declarações conflitantes recuperadas após interrupção do bot');
        disputas += 1;
      }
    } catch (e) {
      erros += 1;
      console.error(`[partida #${m.id}] falha ao recuperar resultado:`, e.message);
    }
  }

  return { verificadas: pendentes.length, finalizadas, disputas, erros };
}

/** Registra a proposta inicial de vencedor; o adversário confirma depois. */
const registrarEscolha = db.transaction((matchId, jogadorId, vencedorId) => {
  const m = get(matchId);
  if (!m) return { erro: 'NAO_EXISTE' };
  if (!['EM_ANDAMENTO', 'AGUARDANDO_RESULTADO'].includes(m.status)) return { erro: 'FORA_DE_HORA', match: m };
  if (!ehJogador(m, jogadorId)) return { erro: 'NAO_E_JOGADOR' };
  if (!ehJogador(m, vencedorId)) return { erro: 'VENCEDOR_INVALIDO' };

  if (m.claim_p1 || m.claim_p2) {
    const autor = m.claim_p1 ? m.p1 : m.p2;
    const escolha = m.claim_p1 || m.claim_p2;
    return { erro: 'JA_EXISTE', match: m, autor, escolha: vencedorEscolhido(m, autor, escolha) };
  }

  const campo = m.p1 === jogadorId ? 'claim_p1' : 'claim_p2';

  db.prepare(
    `UPDATE matches SET ${campo} = ?, status = 'AGUARDANDO_RESULTADO',
     claim_em = COALESCE(claim_em, ?) WHERE id = ?`
  ).run(vencedorId, Date.now(), matchId);

  return {
    ok: true,
    match: get(matchId),
    autor: jogadorId,
    adversario: oponente(m, jogadorId),
    vencedor: vencedorId,
  };
});

/** O primeiro jogador escolhe; o adversário recebe uma confirmação pública. */
async function selecionarVencedor(interaction, matchId, vencedorId) {
  const r = registrarEscolha(matchId, interaction.user.id, vencedorId);

  if (r.erro === 'NAO_EXISTE') {
    return nao(interaction, 'Partida não encontrada', 'Esse ticket não corresponde a nenhuma partida.');
  }
  if (r.erro === 'NAO_E_JOGADOR') {
    return nao(interaction, 'Você não é jogador', 'Só os dois jogadores podem escolher o vencedor.');
  }
  if (r.erro === 'VENCEDOR_INVALIDO') {
    return nao(interaction, 'Escolha inválida', 'Selecione um dos dois jogadores dessa partida.');
  }
  if (r.erro === 'FORA_DE_HORA') {
    return nao(interaction, 'Fora de hora', `Não é possível confirmar o vencedor agora (status: ${r.match.status}).`);
  }
  if (r.erro === 'JA_EXISTE') {
    return nao(interaction, 'Aguardando confirmação',
      `<@${r.autor}> já escolheu <@${r.escolha}>. O adversário precisa confirmar ou chamar suporte.`);
  }

  await interaction.reply(ui.msg(ui.bloco(cfg.COR.aviso,
    ui.titulo('⌛ AGUARDANDO CONFIRMAÇÃO DE VENCEDOR...'),
    ui.nota(`Partida #${matchId}`),
    ui.divisor(),
    ui.txt(`<@${r.autor}> definiu <@${r.vencedor}> como vencedor.`),
    ui.txt(
      `<@${r.adversario}>, confirme no botão verde abaixo.\n` +
      `Se ninguém confirmar em **${cfg.confirmacaoMinutos} minutos**, a escolha registrada será considerada.`
    ),
    ui.divisor(),
    ui.linhaBotoes(
      ui.botao(`match:winner_confirm:${matchId}:${r.vencedor}:${r.autor}`, 'CONFIRMAR VENCEDOR', {
        estilo: ui.ESTILO.Success, emoji: '✅',
      }),
      ui.botao(`match:winner_cancel:${matchId}:${r.autor}`, 'CANCELAR ESCOLHA', {
        estilo: ui.ESTILO.Danger, emoji: '❌',
      }),
      ui.botao(`match:support:${matchId}`, 'CHAMAR SUPORTE', {
        estilo: ui.ESTILO.Danger, emoji: '🆘',
      }),
    ),
    ui.nota('Confira as menções com atenção antes de confirmar.'),
  )));

  return atualizarPainel(interaction.client, matchId);
}

async function confirmarVencedor(interaction, matchId, vencedorId, autorId) {
  const m = get(matchId);
  if (!m) return nao(interaction, 'Partida não encontrada', 'Esse ticket não corresponde a nenhuma partida.');
  if (m.status !== 'AGUARDANDO_RESULTADO') {
    return nao(interaction, 'Fora de hora', 'Essa escolha não está mais aguardando confirmação.');
  }
  if (interaction.user.id !== oponente(m, autorId)) {
    return nao(interaction, 'Não é sua confirmação', 'Somente o adversário de quem escolheu pode confirmar.');
  }
  if (!ehJogador(m, vencedorId)) {
    return nao(interaction, 'Vencedor inválido', 'O vencedor não pertence a esta partida.');
  }

  const escolhaAutor = autorId === m.p1 ? m.claim_p1 : m.claim_p2;
  if (vencedorEscolhido(m, autorId, escolhaAutor) !== vencedorId) {
    return nao(interaction, 'Escolha alterada', 'Essa escolha foi cancelada ou substituída. Use o painel atual.');
  }

  const campo = interaction.user.id === m.p1 ? 'claim_p1' : 'claim_p2';
  db.prepare(`UPDATE matches SET ${campo} = ? WHERE id = ? AND ${campo} IS NULL`).run(vencedorId, matchId);

  await interaction.update(ui.msg(ui.bloco(cfg.COR.sucesso,
    ui.titulo('✅ VENCEDOR CONFIRMADO'),
    ui.txt(`<@${interaction.user.id}> confirmou a vitória de <@${vencedorId}>.`),
  )));

  return finalizarPartida(interaction.client, matchId, vencedorId, 'Vencedor confirmado pelos dois jogadores');
}

async function cancelarEscolhaVencedor(interaction, matchId, autorId) {
  const m = get(matchId);
  if (!m) return nao(interaction, 'Partida não encontrada', 'Esse ticket não corresponde a nenhuma partida.');
  if (interaction.user.id !== autorId) {
    return nao(interaction, 'Não é sua escolha', 'Somente quem selecionou o vencedor pode cancelar. Use CHAMAR SUPORTE se discordar.');
  }
  if (m.status !== 'AGUARDANDO_RESULTADO') {
    return nao(interaction, 'Fora de hora', 'Essa escolha já foi resolvida.');
  }

  const campo = autorId === m.p1 ? 'claim_p1' : 'claim_p2';
  db.prepare(
    `UPDATE matches SET ${campo} = NULL, claim_em = NULL, status = 'EM_ANDAMENTO'
     WHERE id = ? AND ${campo} IS NOT NULL`
  ).run(matchId);

  await interaction.update(ui.msg(ui.bloco(cfg.COR.neutro,
    ui.titulo('↩️ ESCOLHA CANCELADA'),
    ui.txt(`<@${autorId}> cancelou a escolha. O menu do painel está liberado novamente.`),
  )));
  return atualizarPainel(interaction.client, matchId);
}

/* -------------------------------------------------------------- REVANCHE */

const modalRevanche = (matchId) =>
  new ModalBuilder().setCustomId(`match:rematch_modal:${matchId}`).setTitle('Propor revanche')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('valor')
        .setLabel('Valor por jogador')
        .setPlaceholder('Ex: 10 ou 10,50')
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20)));

async function abrirModalRevanche(interaction, matchId) {
  const m = get(matchId);
  if (!m) return nao(interaction, 'Partida não encontrada', 'Essa partida não existe mais.');
  if (m.status !== 'FINALIZADA') {
    return nao(interaction, 'Partida não finalizada', 'A revanche só pode ser proposta depois do resultado.');
  }
  if (!ehJogador(m, interaction.user.id)) {
    return nao(interaction, 'Você não é jogador', 'Só quem jogou essa partida pode pedir revanche.');
  }
  if (revancheDaPartida(matchId)) {
    return nao(interaction, 'Revanche já proposta', 'Já existe uma proposta ou revanche aceita para essa partida.');
  }
  return interaction.showModal(modalRevanche(matchId));
}

async function proporRevanche(interaction, matchId) {
  const m = get(matchId);
  if (!m) return nao(interaction, 'Partida não encontrada', 'Essa partida não existe mais.');
  if (m.status !== 'FINALIZADA') {
    return nao(interaction, 'Partida não finalizada', 'A revanche só pode ser proposta depois do resultado.');
  }
  if (!ehJogador(m, interaction.user.id)) {
    return nao(interaction, 'Você não é jogador', 'Só quem jogou essa partida pode pedir revanche.');
  }

  const amount = money.parse(interaction.fields.getTextInputValue('valor'));
  if (!amount || amount * 2 <= cfg.taxaPartida) {
    return nao(interaction, 'Valor inválido',
      `Use um valor maior que **${money.fmt(Math.floor(cfg.taxaPartida / 2))}** por jogador.`);
  }

  const criar = db.transaction(() => {
    if (revancheDaPartida(matchId)) return { erro: 'JA_EXISTE' };
    const opponentId = oponente(m, interaction.user.id);
    const info = db.prepare(
      `INSERT INTO revanche_propostas
       (match_id, guild_id, thread_id, proposer_id, opponent_id, amount, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(m.id, m.guild_id, m.thread_id, interaction.user.id, opponentId, amount, Date.now());
    return { id: Number(info.lastInsertRowid), opponentId };
  });

  const proposta = criar();
  if (proposta.erro) {
    return nao(interaction, 'Revanche já proposta', 'Já existe uma proposta ou revanche aceita para essa partida.');
  }

  return interaction.reply(ui.msg(ui.bloco(cfg.COR.primaria,
    ui.titulo('🔁 PROPOSTA DE REVANCHE'),
    ui.nota(`Partida anterior #${matchId} · proposta #${proposta.id}`),
    ui.divisor(),
    ui.txt(`<@${interaction.user.id}> desafiou <@${proposta.opponentId}> para jogar novamente **neste mesmo canal**.`),
    ui.tabela([
      ['Valor por jogador', money.fmt(amount)],
      ['Prêmio ao vencedor', money.fmt(amount * 2 - cfg.taxaPartida)],
      ['Taxa da organização', money.fmt(cfg.taxaPartida)],
    ]),
    ui.divisor(),
    ui.txt(`<@${proposta.opponentId}>, você aceita a revanche?`),
    ui.linhaBotoes(
      ui.botao(`match:rematch_accept:${proposta.id}`, 'ACEITAR REVANCHE', {
        estilo: ui.ESTILO.Success, emoji: '✅',
      }),
      ui.botao(`match:rematch_decline:${proposta.id}`, 'RECUSAR', {
        estilo: ui.ESTILO.Danger, emoji: '❌',
      }),
    ),
    ui.nota('Ao aceitar, o bot tenta reservar o valor dos dois automaticamente.'),
  )));
}

const criarPartidaDeRevanche = db.transaction((proposalId, userId) => {
  const p = propostaRevanche(proposalId);
  if (!p) return { erro: 'NAO_EXISTE' };
  if (p.status !== 'PENDENTE') return { erro: 'JA_RESOLVIDA', proposta: p };
  if (p.opponent_id !== userId) return { erro: 'NAO_E_O_ALVO' };

  const anterior = get(p.match_id);
  if (!anterior || anterior.status !== 'FINALIZADA') return { erro: 'PARTIDA_INVALIDA' };

  for (const jogadorId of [p.proposer_id, p.opponent_id]) {
    const ativa = db.prepare(
      `SELECT id FROM matches
       WHERE (p1 = ? OR p2 = ?) AND id != ?
         AND status NOT IN ('FINALIZADA', 'CANCELADA')
       LIMIT 1`
    ).get(jogadorId, jogadorId, anterior.id);
    if (ativa) return { erro: 'EM_PARTIDA', jogadorId, matchId: ativa.id };
  }

  const pagos = {};
  for (const jogadorId of [p.proposer_id, p.opponent_id]) {
    pagos[jogadorId] = wallet.getJogavel(jogadorId) >= p.amount;
    if (pagos[jogadorId]) wallet.lock(jogadorId, p.amount);
  }

  const tudoPago = pagos[p.proposer_id] && pagos[p.opponent_id];
  const info = db.prepare(
    `INSERT INTO matches
     (guild_id, queue_id, modalidade, gelo, valor, taxa, p1, p2, thread_id,
      status, regras, regras_autor, pago_p1, pago_p2, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    p.guild_id, anterior.modalidade, anterior.gelo, p.amount, cfg.taxaPartida,
    p.proposer_id, p.opponent_id, p.thread_id,
    tudoPago ? 'EM_ANDAMENTO' : 'AGUARDANDO_PAGAMENTO',
    anterior.regras, anterior.regras_autor,
    pagos[p.proposer_id] ? 1 : 0, pagos[p.opponent_id] ? 1 : 0, Date.now(),
  );

  const newMatchId = Number(info.lastInsertRowid);
  db.prepare(
    "UPDATE revanche_propostas SET status = 'ACEITA', new_match_id = ?, updated_at = ? WHERE id = ?"
  ).run(newMatchId, Date.now(), proposalId);

  return { ok: true, proposta: p, match: get(newMatchId), pagos };
});

async function aceitarRevanche(interaction, proposalId) {
  const r = criarPartidaDeRevanche(proposalId, interaction.user.id);
  if (r.erro === 'NAO_EXISTE') return nao(interaction, 'Proposta não encontrada', 'Essa proposta não existe.');
  if (r.erro === 'JA_RESOLVIDA') return nao(interaction, 'Proposta já resolvida', 'Essa proposta já foi aceita ou recusada.');
  if (r.erro === 'NAO_E_O_ALVO') return nao(interaction, 'Não é para você', 'Só o jogador desafiado pode aceitar.');
  if (r.erro === 'PARTIDA_INVALIDA') return nao(interaction, 'Partida indisponível', 'A partida anterior não pode gerar revanche agora.');
  if (r.erro === 'EM_PARTIDA') {
    return nao(interaction, 'Partida em aberto', `<@${r.jogadorId}> ainda está na partida #${r.matchId}.`);
  }

  const m = r.match;
  await interaction.update(ui.msg(ui.bloco(cfg.COR.sucesso,
    ui.titulo('✅ REVANCHE ACEITA'),
    ui.txt(`<@${interaction.user.id}> aceitou. A revanche virou a **partida #${m.id}** neste canal.`),
  )));

  const msgPainel = await interaction.channel.send(mensagemPainel(m, { anexarBanner: true }));
  db.prepare('UPDATE matches SET painel_msg_id = ? WHERE id = ?').run(msgPainel.id, m.id);
  await msgPainel.pin().catch(() => {});

  if (pagouTudo(m)) {
    await interaction.channel.send(ui.msg(ui.bloco(cfg.COR.primaria,
      ui.titulo('🔴 REVANCHE INICIADA'),
      ui.nota(`Partida #${m.id} · ${m.modalidade} · ${modo(m)}`),
      ui.divisor(),
      ui.txt(
        `<@${m.p1}> e <@${m.p2}>, os dois valores foram reservados. **Podem começar!**\n\n` +
        'No fim, um jogador seleciona o vencedor e o adversário confirma.'
      ),
    )));
    await interaction.channel.send(ui.msg(painelSuporte(m))).catch(() => {});
  } else {
    const faltando = devendo(m);
    await interaction.channel.send(ui.msg(ui.bloco(cfg.COR.aviso,
      ui.titulo('💳 SALDO INSUFICIENTE PARA A REVANCHE'),
      ui.txt(
        `${faltando.map((id) => `<@${id}>`).join(' e ')} não tem saldo suficiente. ` +
        'Abri um canal de depósito para cada jogador pendente.'
      ),
      ui.nota(`O pagamento precisa cair em ${cfg.pagamentoMinutos} minutos para a revanche começar.`),
    )));

    const carteira = require('./carteira');
    for (const jogadorId of faltando) {
      await carteira.criarCobrancaPartidaAutomatica(interaction.client, m, jogadorId).catch((e) => {
        console.error(`[revanche #${m.id}] falha ao abrir depósito para ${jogadorId}:`, e.message);
      });
    }
  }

  await avisarNoPv(interaction.client, m, interaction.channel);
}

async function recusarRevanche(interaction, proposalId) {
  const p = propostaRevanche(proposalId);
  if (!p) return nao(interaction, 'Proposta não encontrada', 'Essa proposta não existe.');
  if (p.opponent_id !== interaction.user.id) {
    return nao(interaction, 'Não é para você', 'Só o jogador desafiado pode recusar.');
  }
  const alterou = db.prepare(
    "UPDATE revanche_propostas SET status = 'RECUSADA', updated_at = ? WHERE id = ? AND status = 'PENDENTE'"
  ).run(Date.now(), proposalId);
  if (!alterou.changes) return nao(interaction, 'Proposta já resolvida', 'Essa proposta já foi aceita ou recusada.');

  return interaction.update(ui.msg(ui.bloco(cfg.COR.neutro,
    ui.titulo('❌ REVANCHE RECUSADA'),
    ui.txt(`<@${interaction.user.id}> recusou a proposta. GG e até a próxima!`),
  )));
}

/** Transforma qualquer problema no resultado em disputa acompanhada pela staff. */
async function chamarSuporte(interaction, matchId) {
  const m = get(matchId);
  if (!m) return nao(interaction, 'Partida não encontrada', 'Esse ticket não corresponde a nenhuma partida.');
  if (!ehJogador(m, interaction.user.id)) {
    return nao(interaction, 'Você não é jogador', 'Só os jogadores dessa partida podem chamar suporte.');
  }
  if (['DISPUTA', 'SS_SOLICITADO', 'REVISAO'].includes(m.status)) {
    return nao(interaction, 'Suporte já chamado', 'A equipe já foi notificada e está acompanhando essa partida.');
  }
  if (['FINALIZADA', 'CANCELADA'].includes(m.status)) {
    return nao(interaction, 'Partida encerrada', 'Não é possível abrir um SOS depois que a partida foi encerrada.');
  }

  await interaction.reply(ui.msg(ui.bloco(cfg.COR.aviso,
    ui.titulo('🆘 SUPORTE CHAMADO'),
    ui.txt('SOS enviado! A partida foi pausada e a staff recebeu o chamado fora do ticket.'),
    ui.nota('Se for necessário VAR, somente a staff poderá encaminhar o caso.'),
  ), { efemero: true }));

  return abrirDisputa(
    interaction.client,
    matchId,
    `🆘 SOS solicitado por <@${interaction.user.id}> durante a fase **${m.status}**`,
  );
}

/* --------------------------------------------------------------- PEDIR TELA */

/** Requisito mínimo de kills/dano para ter direito a pedir tela. */
const REQUISITO_SS = {
  '2x2': { jogadores: 1, kills: 6, dano: 2800 },
  '3x3': { jogadores: 2, kills: 8, dano: 3200 },
  '4x4': { jogadores: 2, kills: 8, dano: 3200 },
  // 1x1 nao foi definido pela organizacao: segue o mesmo criterio do 2x2.
  '1x1': { jogadores: 1, kills: 6, dano: 2800 },
};

const requisitoDe = (m) => REQUISITO_SS[m.modalidade.slice(0, 3).toLowerCase()] || REQUISITO_SS['2x2'];

const modalTela = (matchId) =>
  new ModalBuilder().setCustomId(`match:ss_modal:${matchId}`).setTitle('Pedir tela (SS)')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('nicks')
        .setLabel('Nick do(s) telado(s)')
        .setPlaceholder('Um por linha, se for mais de um')
        .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300)));

/** Passo 1: valida a fase e abre o modal pedindo os nicks. */
async function abrirPedidoDeTela(interaction, matchId) {
  const m = get(matchId);
  if (!m) return nao(interaction, 'Partida não encontrada', 'Esse ticket não corresponde a nenhuma partida.');
  if (!ehJogador(m, interaction.user.id)) {
    return nao(interaction, 'Você não é jogador', 'Só os jogadores dessa partida podem pedir tela.');
  }
  if (['FINALIZADA', 'CANCELADA'].includes(m.status)) {
    return nao(interaction, 'Partida encerrada', 'Essa partida já foi finalizada ou cancelada.');
  }
  if (!PODE_PEDIR_TELA.includes(m.status)) {
    return nao(interaction, 'Fora de hora',
      'A tela só pode ser pedida depois que o resultado entrar em **disputa**. Use `CHAMAR SUPORTE` no painel.');
  }
  return interaction.showModal(modalTela(matchId));
}

/** Passo 2: guarda os nicks e mostra as regras para o jogador confirmar. */
async function confirmarRegrasTela(interaction, matchId) {
  const m = get(matchId);
  if (!m) return nao(interaction, 'Partida não encontrada', 'Esse ticket não corresponde a nenhuma partida.');
  if (!ehJogador(m, interaction.user.id)) {
    return nao(interaction, 'Você não é jogador', 'Só os jogadores dessa partida podem pedir tela.');
  }
  if (!PODE_PEDIR_TELA.includes(m.status)) {
    return nao(interaction, 'Fora de hora', 'A partida não está mais na fase em que é possível pedir tela.');
  }

  const nicks = interaction.fields.getTextInputValue('nicks').trim();
  db.prepare('UPDATE matches SET ss_nicks = ? WHERE id = ?').run(nicks, matchId);

  const req = requisitoDe(m);
  const alvo = req.jogadores === 1
    ? `**1 jogador** com **${req.kills} kills** ou **${req.dano} de dano**`
    : `**${req.jogadores} jogadores** com **${req.kills} kills** ou **${req.dano} de dano**`;

  return interaction.reply(ui.msg(ui.bloco(cfg.COR.aviso,
    ui.titulo('🖥️ CONFIRME ANTES DE CHAMAR O SS'),
    ui.nota(`Partida #${matchId} · ${m.modalidade}`),
    ui.divisor(),
    ui.secao('👤 Quem você quer telar'),
    ui.txt('```\n' + nicks + '\n```'),
    ui.divisor(),
    ui.secao('📋 Quantidade mínima para pedir tela'),
    ui.txt(
      '➜ **2x2** — jogador com **6 kills** ou **2800 de dano**\n' +
      '➜ **3x3 / 4x4** — **2 jogadores** com **8 kills** ou **3200 de dano**'
    ),
    ui.divisor(),
    ui.txt(
      `Nesta partida (**${m.modalidade}**) o critério é: ${alvo}.\n\n` +
      '⚠️ **Pedir tela sem atingir esses números é passível de punição.**\n' +
      'Confirme apenas se o adversário realmente bateu o requisito.'
    ),
    ui.linhaBotoes(
      ui.botao(`match:ss_ok:${matchId}`, 'CONFIRMO E QUERO A TELA', { estilo: ui.ESTILO.Danger, emoji: '🖥️' }),
      ui.botao(`match:ss_no:${matchId}`, 'DESISTIR', { emoji: '↩️' }),
    ),
  ), { efemero: true }));
}

/** Passo 3: confirmado — aciona o SS de verdade. */
async function pedirTela(interaction, matchId) {
  const m = get(matchId);
  if (!m) return nao(interaction, 'Partida não encontrada', 'Esse ticket não corresponde a nenhuma partida.');
  if (!ehJogador(m, interaction.user.id)) {
    return nao(interaction, 'Você não é jogador', 'Só os jogadores dessa partida podem pedir tela.');
  }
  if (['FINALIZADA', 'CANCELADA'].includes(m.status)) {
    return nao(interaction, 'Partida encerrada', 'Essa partida já foi finalizada ou cancelada.');
  }
  if (!PODE_PEDIR_TELA.includes(m.status)) {
    return nao(interaction, 'Fora de hora',
      'A tela só pode ser pedida depois que o resultado entrar em **disputa**. Use `CHAMAR SUPORTE` no painel.');
  }

  const marcou = db.prepare(
    "UPDATE matches SET status = 'SS_SOLICITADO', ss_por = ? WHERE id = ? AND status IN ('AGUARDANDO_RESULTADO', 'DISPUTA')"
  ).run(interaction.user.id, matchId);
  if (marcou.changes === 0) {
    return nao(interaction, 'Pedido já processado', 'A fase da partida mudou ou uma tela já foi solicitada.');
  }

  // B.O.: entra na fila de análise para o controle de tempo/quantidade por analista.
  try {
    require('./analises').abrirAnalise(matchId, m.guild_id);
  } catch (e) {
    console.error(`[partida #${matchId}] falha ao abrir análise (B.O.):`, e.message);
  }

  const cargoSS = gc.get(m.guild_id, 'cargo_staff_ss') || gc.get(m.guild_id, 'cargo_staff');
  const adv = oponente(m, interaction.user.id);

  const nicks = m.ss_nicks || '(não informado)';

  // O botão veio da confirmação privada: fecha ela e publica o chamado no ticket.
  await interaction.update(ui.msg(ui.bloco(cfg.COR.sucesso,
    ui.titulo('✅ CHAMADO ENVIADO'),
    ui.txt('O staff de SS foi avisado. Aguarde no ticket.'),
  )));

  await interaction.channel.send(ui.msg(ui.bloco(cfg.COR.aviso,
    ui.titulo('🖥️ TELA SOLICITADA'),
    ui.nota(`Partida #${matchId} · ${m.modalidade} · ${money.fmt(m.valor)}`),
    ui.divisor(),
    ui.txt(`${cargoSS ? `<@&${cargoSS}>\n\n` : ''}<@${interaction.user.id}> pediu **tela (SS)** de <@${adv}>.`),
    ui.secao('👤 Nick(s) informado(s)'),
    ui.txt('```\n' + nicks + '\n```'),
    ui.divisor(),
    ui.secao('👥 Jogadores'),
    ui.txt(placar(m)),
    ui.divisor(),
    ui.txt(
      '⚠️ O pagamento fica **travado** até o staff de SS dar o veredito.\n' +
      'A partir de agora **quem define o vencedor é o staff**.'
    ),
    await botoesVeredito(interaction.client, m),
  )));

  // Regras da telagem, marcando o acusado.
  await interaction.channel.send(ui.msg(ui.bloco(cfg.COR.erro,
    ui.titulo('📋 PEDIDO DE TELA'),
    ui.txt(`<@${adv}> — **você foi o acusado.** Leia as regras abaixo.`),
    ui.divisor(),
    ui.txt(
      '• O pedido deve ser feito em até **2 minutos** após a partida.\n' +
      '• É obrigatório informar o **nick**, caso contrário o pedido será desconsiderado.\n' +
      '• O acusado possui **5 minutos** para entrar na análise. Caso não entre, será **W.O.**\n' +
      '• Ao entrar na call, **abra a tela imediatamente**.\n' +
      '• O **replay** deve ser aberto e reproduzido ao adversário assim que entrar na call.\n' +
      '• Caso você solicite tela, **permaneça na call durante toda a análise**. Ficar mais de ' +
      '1 minuto fora poderá conceder vitória ao seu adversário.\n' +
      '• Em **tela dupla**, ambos abram a tela ao mesmo tempo e o analista verifica um por vez.\n' +
      '• Jogadores com até **4 kills e baixo dano** poderão ser dispensados da análise — ' +
      'exceto em casos de blacklist.'
    ),
    ui.divisor(),
    ui.txt(
      '⚠️ Forçar **W.O.** de forma indevida resultará em punição.\n' +
      '🎥 **Grave toda a telagem**, do início ao fim. Sem provas, não haverá revisão.\n' +
      '🚫 **Não siga instruções do adversário**, exceto a de mostrar o replay.'
    ),
  )));

  // Chama no privado todo mundo que tem o cargo de SS.
  const chaveCargoSS = gc.get(m.guild_id, 'cargo_staff_ss') ? 'cargo_staff_ss' : 'cargo_staff';
  await notificar.chamarCargo(interaction.client, m.guild_id, chaveCargoSS, {
    titulo: '🖥️ CHAMADO DE TELA (SS)',
    descricao:
      `**Partida #${m.id}**\n\nSolicitante: <@${interaction.user.id}>\nAlvo do SS: <@${adv}>\n\n` +
      'O pagamento está travado até alguém da equipe dar o veredito.',
    dados: [
      ['Modalidade', m.modalidade],
      ['Valor por jogador', money.fmt(m.valor)],
      ['Premio em disputa', money.fmt(premio(m))],
    ],
    canalId: m.thread_id,
    rotuloBotao: 'IR PARA O TICKET',
  });

  // Espelha o chamado no canal de SS para a staff ver fora do ticket.
  const canalSS = await gc.channel(interaction.client, m.guild_id, 'canal_ss');
  if (canalSS) {
    await canalSS.send(ui.msg(ui.bloco(cfg.COR.aviso,
      ui.titulo('🖥️ NOVO CHAMADO DE TELA (SS)'),
      ui.txt(`${cargoSS ? `<@&${cargoSS}> · ` : ''}Partida #${m.id}`),
      ui.divisor(),
      ui.tabela([
        ['Modalidade', m.modalidade],
        ['Valor por jogador', money.fmt(m.valor)],
      ]),
      ui.txt(`Solicitante: <@${interaction.user.id}>\nAlvo do SS: <@${adv}>`),
      ui.txt('**Nick(s) informado(s):**\n```\n' + nicks + '\n```'),
      ui.comBotao(
        '**Ticket da partida**',
        ui.botaoLink(notificar.linkPara(m.guild_id, m.thread_id), 'ABRIR TICKET', '⚔️'),
      ),
    ))).catch(() => {});
  }

  await atualizarPainel(interaction.client, matchId);
}

/** Nome de exibicao no servidor; cai para o username, e por ultimo para o ID. */
async function nomeDe(client, guildId, userId) {
  try {
    const guild = await client.guilds.fetch(guildId);
    const membro = await guild.members.fetch(userId);
    return membro.displayName;
  } catch {
    try {
      const user = await client.users.fetch(userId);
      return user.displayName || user.username;
    } catch {
      return userId;
    }
  }
}

/**
 * Botoes de veredito com o NOME de cada jogador — a staff precisa saber em quem
 * está clicando, "P1/P2" no meio de uma disputa nao diz nada.
 */
async function botoesVeredito(client, m) {
  const [n1, n2] = await Promise.all([
    nomeDe(client, m.guild_id, m.p1),
    nomeDe(client, m.guild_id, m.p2),
  ]);
  const label = (n) => `VITÓRIA: ${n}`.slice(0, 80); // botão aceita 80 caracteres

  return ui.linhaBotoes(
    ui.botao(`match:verdict:${m.id}:${m.p1}`, label(n1), { estilo: ui.ESTILO.Success, emoji: '1️⃣' }),
    ui.botao(`match:verdict:${m.id}:${m.p2}`, label(n2), { estilo: ui.ESTILO.Success, emoji: '2️⃣' }),
    ui.botao(`match:staffcancel:${m.id}`, 'ANULAR (devolver os 2)', { estilo: ui.ESTILO.Danger, emoji: '🚫' }),
  );
}

/* ------------------------------------------------------------------ DISPUTA */

async function abrirDisputa(client, matchId, motivo) {
  const m = get(matchId);
  if (!m || ['FINALIZADA', 'CANCELADA'].includes(m.status)) return;
  setStatus(matchId, 'DISPUTA');

  const cargoStaff = gc.get(m.guild_id, 'cargo_staff');
  const thread = await client.channels.fetch(m.thread_id).catch(() => null);

  if (thread) {
    await thread.send(ui.msg(ui.bloco(cfg.COR.erro,
      ui.titulo('🆘 SUPORTE ACIONADO'),
      ui.nota(`Partida #${matchId} · ${m.modalidade} · ${money.fmt(m.valor)}`),
      ui.divisor(),
      ui.txt(`${cargoStaff ? `<@&${cargoStaff}>\n\n` : ''}${motivo}`),
      ui.divisor(),
      ui.txt(
        '**A partida fica pausada até a staff orientar os jogadores.**\n' +
        'Mandem neste ticket as informações, prints e provas do problema.'
      ),
      await botoesVeredito(client, m),
    )));
  }

  // Chama no privado todo mundo que tem o cargo de staff.
  await notificar.chamarCargo(client, m.guild_id, 'cargo_staff', {
    titulo: '🆘 SUPORTE ACIONADO',
    descricao: `**Partida #${m.id}**\n\n${motivo}\n\nA partida está pausada até alguém da equipe atender.`,
    dados: [
      ['Modalidade', m.modalidade],
      ['Valor por jogador', money.fmt(m.valor)],
      ['Premio em disputa', money.fmt(premio(m))],
    ],
    canalId: m.thread_id,
    rotuloBotao: 'IR PARA O TICKET',
    cor: cfg.COR.erro,
  });

  const canalSS = await gc.channel(client, m.guild_id, 'canal_ss');
  if (canalSS) {
    await canalSS.send(ui.msg(ui.bloco(cfg.COR.erro,
      ui.titulo('🆘 NOVO CHAMADO DE SUPORTE'),
      ui.txt(`${cargoStaff ? `<@&${cargoStaff}> · ` : ''}Partida #${m.id}`),
      ui.divisor(),
      ui.tabela([
        ['Modalidade', m.modalidade],
        ['Valor por jogador', money.fmt(m.valor)],
      ]),
      ui.txt(`${motivo}\n\n${placar(m)}`),
      ui.txt('A staff pode resolver pelo ticket ou encaminhar o caso para o VAR.'),
      ui.linhaBotoes(
        ui.botaoLink(notificar.linkPara(m.guild_id, m.thread_id), 'ABRIR TICKET', '⚔️'),
        ui.botao(`match:staff_var:${m.id}`, 'CHAMAR VAR', {
          estilo: ui.ESTILO.Danger, emoji: '🎥',
        }),
      ),
    ))).catch(() => {});
  }

  await atualizarPainel(client, matchId);
}

/** Somente a staff, pelo canal interno, pode encaminhar um SOS para o VAR. */
async function chamarVarStaff(interaction, matchId) {
  if (!gc.hasRole(interaction.member, 'cargo_staff') &&
      !gc.hasRole(interaction.member, 'cargo_staff_ss')) {
    return nao(interaction, 'Sem permissão', 'Somente a staff pode chamar o VAR.');
  }

  const m = get(matchId);
  if (!m) return nao(interaction, 'Partida não encontrada', 'Essa partida não existe.');
  if (['FINALIZADA', 'CANCELADA'].includes(m.status)) {
    return nao(interaction, 'Partida encerrada', 'O VAR não pode ser aberto para uma partida encerrada.');
  }

  const analises = require('./analises');
  let analise = db.prepare(
    "SELECT * FROM analises WHERE match_id = ? AND status IN ('FILA', 'EM_ANDAMENTO') ORDER BY id DESC LIMIT 1"
  ).get(matchId);
  if (!analise) {
    const analiseId = Number(analises.abrirAnalise(matchId, m.guild_id));
    analise = analises.getAnalise(analiseId);
  }

  db.prepare(
    "UPDATE matches SET status = 'SS_SOLICITADO', ss_por = ?, staff_id = ? WHERE id = ?"
  ).run(interaction.user.id, interaction.user.id, matchId);

  await interaction.update(ui.msg(ui.bloco(cfg.COR.sucesso,
    ui.titulo('🎥 VAR ACIONADO PELA STAFF'),
    ui.txt(`<@${interaction.user.id}> encaminhou a partida #${matchId} para análise.`),
    ui.nota(`Análise #${analise.id}`),
  )));

  const thread = await interaction.client.channels.fetch(m.thread_id).catch(() => null);
  if (thread) {
    await thread.send(ui.msg(ui.bloco(cfg.COR.aviso,
      ui.titulo('🎥 CASO ENCAMINHADO AO VAR'),
      ui.nota(`Partida #${matchId} · análise #${analise.id}`),
      ui.divisor(),
      ui.txt(
        `<@${m.p1}> e <@${m.p2}>, a staff encaminhou este caso para o VAR.\n\n` +
        'O valor permanece reservado até a equipe concluir a análise e dar o veredito.'
      ),
    ))).catch(() => {});
  }

  const cargoAnalista = gc.get(m.guild_id, 'cargo_analista')
    || gc.get(m.guild_id, 'cargo_staff_ss')
    || gc.get(m.guild_id, 'cargo_staff');
  const canalAnalises = await gc.channel(interaction.client, m.guild_id, 'canal_analises')
    || await gc.channel(interaction.client, m.guild_id, 'canal_ss');
  if (canalAnalises) {
    await canalAnalises.send(ui.msg(ui.bloco(cfg.COR.primaria,
      ui.titulo('🎥 NOVO CASO NO VAR'),
      ui.txt(`${cargoAnalista ? `<@&${cargoAnalista}> · ` : ''}Análise #${analise.id}`),
      ui.divisor(),
      ui.tabela([
        ['Partida', `#${m.id}`],
        ['Modalidade', m.modalidade],
        ['Valor por jogador', money.fmt(m.valor)],
      ]),
      ui.txt(`Jogadores: <@${m.p1}> vs <@${m.p2}>\nEncaminhado por: <@${interaction.user.id}>`),
      ui.comBotao(
        'Use `/bo assumir` para assumir a análise e abra o ticket para verificar o caso.',
        ui.botaoLink(notificar.linkPara(m.guild_id, m.thread_id), 'ABRIR TICKET', '⚔️'),
      ),
    ))).catch(() => {});
  }

  await atualizarPainel(interaction.client, matchId);
  return analise;
}

async function veredito(interaction, matchId, vencedorId) {
  if (!gc.hasRole(interaction.member, 'cargo_staff') && !gc.hasRole(interaction.member, 'cargo_staff_ss')) {
    return nao(interaction, 'Sem permissão', 'Só a staff pode dar o veredito.');
  }
  const m = get(matchId);
  if (!m) return nao(interaction, 'Partida não encontrada', 'Esse ticket não corresponde a nenhuma partida.');
  if (['FINALIZADA', 'CANCELADA'].includes(m.status)) {
    return nao(interaction, 'Partida encerrada', 'Essa partida já foi finalizada ou cancelada.');
  }

  db.prepare('UPDATE matches SET staff_id = ? WHERE id = ?').run(interaction.user.id, matchId);

  await interaction.update(ui.msg(ui.bloco(cfg.COR.sucesso,
    ui.titulo('⚖️ VEREDITO DADO'),
    ui.txt(`<@${interaction.user.id}> declarou <@${vencedorId}> como vencedor.`),
  )));
  await finalizarPartida(interaction.client, matchId, vencedorId, `Veredito da staff · <@${interaction.user.id}>`);
}

/* ---------------------------------------------------------- FIM DA PARTIDA */

/** Move o dinheiro. Idempotente pelo status FINALIZADA. */
const pagarVencedor = db.transaction((m, vencedorId) => {
  const perdedorId = oponente(m, vencedorId);

  wallet.consumeLocked(vencedorId, m.valor, 'APOSTA', `Aposta partida #${m.id}`, `match:${m.id}`);
  wallet.consumeLocked(perdedorId, m.valor, 'APOSTA', `Aposta partida #${m.id}`, `match:${m.id}`);
  const saldo = wallet.credit(vencedorId, premio(m), 'PREMIO', `Prêmio partida #${m.id}`, `match:${m.id}`);
  wallet.logTx(vencedorId, 'TAXA', 0, saldo, `Taxa da organização (${money.fmt(m.taxa)}) na partida #${m.id}`, `match:${m.id}`);

  db.prepare('UPDATE users SET wins = wins + 1 WHERE discord_id = ?').run(vencedorId);
  db.prepare('UPDATE users SET losses = losses + 1 WHERE discord_id = ?').run(perdedorId);
  db.prepare("UPDATE matches SET status = 'FINALIZADA', winner_id = ?, finished_at = ? WHERE id = ?")
    .run(vencedorId, Date.now(), m.id);

  return saldo;
});

async function finalizarPartida(client, matchId, vencedorId, motivo) {
  const m = get(matchId);
  if (!m || m.status === 'FINALIZADA' || m.status === 'CANCELADA') return;
  if (!ehJogador(m, vencedorId)) return;

  // Trava de segurança: sem os dois valores garantidos não existe prêmio a pagar.
  if (!pagouTudo(m)) {
    console.error(`[partida #${matchId}] tentativa de finalizar sem os dois pagamentos.`);
    const t0 = await client.channels.fetch(m.thread_id).catch(() => null);
    if (t0) {
      await t0.send(ui.msg(ui.bloco(cfg.COR.erro,
        ui.titulo('❌ PAGAMENTO PENDENTE'),
        ui.txt(`Não dá para finalizar: ${devendo(m).map((id) => `<@${id}>`).join(' e ')} não pagou a partida.`),
      )));
    }
    return;
  }

  let saldo;
  try {
    saldo = pagarVencedor(m, vencedorId);
  } catch (e) {
    console.error(`[partida #${matchId}] falha ao pagar:`, e.message);
    const t = await client.channels.fetch(m.thread_id).catch(() => null);
    if (t) {
      await t.send(ui.msg(ui.bloco(cfg.COR.erro,
        ui.titulo('❌ ERRO AO PROCESSAR O PAGAMENTO'),
        ui.txt('**Chame a staff** — nenhum valor foi movido.'),
      )));
    }
    return;
  }

  const perdedorId = oponente(m, vencedorId);
  const thread = await client.channels.fetch(m.thread_id).catch(() => null);

  try {
    require('./analises').concluirPorMatch(matchId);
  } catch (e) {
    console.error(`[partida #${matchId}] falha ao concluir análise (B.O.):`, e.message);
  }

  // Fila exclusiva de streamer: recoloca ele na fila pro próximo desafiante.
  try {
    await require('./filaStreamer').reseedSeNecessario(client, m);
  } catch (e) {
    console.error(`[partida #${matchId}] falha ao reassentar streamer na fila:`, e.message);
  }

  // Completar aposta: se o lado vencedor tinha um completa aceito, repassa a
  // fatia proporcional do premio para o completador antes de anunciar.
  let liquidacao = null;
  try {
    const completar = require('./completar');
    liquidacao = completar.liquidarNaVitoria(m, vencedorId);
  } catch (e) {
    console.error(`[partida #${matchId}] falha ao liquidar completa:`, e.message);
  }

  if (thread) {
    await thread.send(ui.msg(ui.bloco(cfg.COR.sucesso,
      ui.titulo('🏆 PARABÉNS AO VENCEDOR!'),
      ui.nota(`Partida #${matchId} · ${m.modalidade} · ${modo(m)}`),
      ui.divisor(),
      ui.txt(
        `🎉 Parabéns, <@${vencedorId}>! Você venceu a partida e ganhou **${money.fmt(premio(m))}**.\n` +
        `GG, <@${perdedorId}>!`
      ),
      ui.divisor(),
      ui.tabela([
        ['Premio creditado', money.fmt(premio(m))],
        ['Saldo do vencedor', money.fmt(liquidacao ? saldo - liquidacao.fatia : saldo)],
        ['Taxa da organizacao', money.fmt(m.taxa)],
      ]),
      liquidacao ? ui.txt(`🤝 <@${liquidacao.completadorId}> recebeu **${money.fmt(liquidacao.fatia)}** da fatia dele.`) : null,
      ui.txt(`_${motivo}_`),
      ui.divisor(),
      ui.comBotao(
        '💡 Para receber em dinheiro, peça um **saque** no painel de saldo.',
        ui.botao('wallet:profile', 'MEU PERFIL', { emoji: '👤' }),
      ),
      ui.divisor(),
      ui.secao('🔁 Querem jogar de novo?'),
      ui.comBotao(
        'Qualquer um dos dois pode propor uma revanche. Você informa o novo valor e o adversário decide.',
        ui.botao(`match:rematch:${matchId}`, 'PEDIR REVANCHE', {
          estilo: ui.ESTILO.Primary, emoji: '🔁',
        }),
      ),
      ui.nota('Se aceitarem, a nova partida começa neste mesmo canal.'),
    )));
  }

  // Pontos de ranqueada: vencedor sobe, perdedor desce (nunca abaixo de zero).
  await pontuarPartida(client, m, vencedorId, perdedorId, thread, motivo);

  // Atualiza o painel ANTES de agendar o fechamento: editar mensagem
  // desarquiva a thread, e isso reabriria o ticket que acabamos de fechar.
  await atualizarPainel(client, matchId);
  await logs.partida(client, m.guild_id, get(matchId), { winnerId: vencedorId, motivo });

  // Transcript: prova da negociação/resultado, capturada antes de trancar o ticket.
  if (thread) {
    try {
      await require('../lib/transcript').capturar(client, thread.id, 'MATCH', matchId, m.guild_id);
    } catch (e) {
      console.error(`[partida #${matchId}] falha ao capturar transcript:`, e.message);
    }
  }

  // Dá tempo para os jogadores combinarem uma revanche. Uma proposta pendente
  // ou uma nova partida ativa impede o fechamento automático deste canal.
  if (thread) await fecharTicket(thread, matchId, 300);
}

/**
 * Distribui os pontos de ranqueada e ajusta cargos de elo e de pódio.
 * Erro aqui não pode derrubar a finalização: o dinheiro já foi pago.
 */
async function pontuarPartida(client, m, vencedorId, perdedorId, thread, motivo = '') {
  try {
    const elo = require('./elo');
    const ranking = require('./ranking');

    const rV = await elo.registrar(client, m.guild_id, vencedorId,
      cfg.pontosVitoria, `Vitória na partida #${m.id}`, `match:${m.id}`);
    const rP = await elo.registrar(client, m.guild_id, perdedorId,
      -cfg.pontosDerrota, `Derrota na partida #${m.id}`, `match:${m.id}`);

    if (thread) {
      await thread.send(ui.msg(ui.bloco(rV.eloDepois.cor,
        ui.titulo('🎖️ PONTOS DA PARTIDA'),
        ui.divisor(),
        ui.txt(
          `🥇 <@${vencedorId}> **+${rV.delta}** → ${rV.eloDepois.emoji} ${rV.eloDepois.nome} · \`${rV.depois} pts\`\n` +
          `💀 <@${perdedorId}> **${rP.delta}** → ${rP.eloDepois.emoji} ${rP.eloDepois.nome} · \`${rP.depois} pts\``
        ),
      )));

      for (const [userId, r] of [[vencedorId, rV], [perdedorId, rP]]) {
        if (r.subiu || r.caiu) await thread.send(ui.msg(elo.painelPromocao(userId, r)));
      }
    }

    await ranking.atualizarTudo(client, m.guild_id);

    // Win streak: some entre o try para nao derrubar pontos/ranking se falhar.
    try {
      const streak = require('./streak');
      await streak.registrar(client, m.guild_id, vencedorId, perdedorId, m);
    } catch (e) {
      console.error(`[partida #${m.id}] falha no win streak:`, e.message);
    }

    // Eventos personalizados (W.O./revanche/consecutividade): mesma logica de isolamento.
    try {
      const eventos = require('./eventos');
      await eventos.registrar(client, m.guild_id, vencedorId, perdedorId, m, motivo);
    } catch (e) {
      console.error(`[partida #${m.id}] falha nos eventos:`, e.message);
    }
  } catch (e) {
    console.error(`[partida #${m.id}] falha ao pontuar:`, e.message);
  }
}

/**
 * Fecha o ticket: tranca e arquiva.
 *
 * Os dois pedidos precisam ser sequenciais — disparados juntos, um sobrescreve
 * o outro e a thread fica aberta. Erro aqui NAO pode ser silencioso: quase
 * sempre e falta da permissao "Gerenciar Tópicos" para o bot.
 */
async function fecharTicket(thread, matchId, segundos) {
  await thread.send(ui.msg(ui.bloco(cfg.COR.neutro,
    ui.txt(`🔒 Este ticket será fechado em **${segundos} segundos**.`),
  ))).catch(() => {});

  setTimeout(async () => {
    try {
      const novaAtiva = db.prepare(
        `SELECT id FROM matches
         WHERE thread_id = ? AND id != ? AND status NOT IN ('FINALIZADA', 'CANCELADA')
         LIMIT 1`
      ).get(thread.id, matchId);
      const propostaPendente = db.prepare(
        "SELECT id, created_at FROM revanche_propostas WHERE match_id = ? AND status = 'PENDENTE' LIMIT 1"
      ).get(matchId);

      if (novaAtiva) {
        console.log(
          `[partida #${matchId}] ticket mantido aberto por revanche ativa #${novaAtiva.id}`
        );
        return;
      }

      if (propostaPendente) {
        // A proposta ganha mais uma janela para resposta. Depois disso expira,
        // evitando que um botão abandonado mantenha o canal aberto para sempre.
        if (propostaPendente.created_at > Date.now() - 5 * 60_000) {
          console.log(`[partida #${matchId}] aguardando proposta de revanche #${propostaPendente.id}`);
          await fecharTicket(thread, matchId, 300);
          return;
        }
        db.prepare(
          "UPDATE revanche_propostas SET status = 'EXPIRADA', updated_at = ? WHERE id = ? AND status = 'PENDENTE'"
        ).run(Date.now(), propostaPendente.id);
      }

      // Se algo arquivou antes da hora, reabre para conseguir trancar.
      if (thread.archived) await thread.setArchived(false);
      await thread.setLocked(true);
      await thread.setArchived(true);
      console.log(`🔒 Ticket da partida #${matchId} fechado.`);
    } catch (e) {
      console.error(
        `[partida #${matchId}] NAO consegui fechar o ticket: ${e.message}\n` +
        '   Confira se o bot tem a permissao "Gerenciar Tópicos" (Manage Threads) no canal de tickets.'
      );
      await thread.send(ui.msg(ui.bloco(cfg.COR.aviso,
        ui.txt('⚠️ Não consegui trancar este ticket automaticamente.\n' +
          'Staff: falta a permissão **Gerenciar Tópicos** para o bot.'),
      ))).catch(() => {});
    }
  }, segundos * 1000);
}

/**
 * Cancela e devolve o valor de quem chegou a pagar.
 * Quem entrou na fila sem saldo e não pagou não tem nada travado para devolver.
 */
const estornarAmbos = db.transaction((m) => {
  for (const [userId, pago] of [[m.p1, m.pago_p1], [m.p2, m.pago_p2]]) {
    if (!pago) continue;
    try {
      wallet.unlock(userId, m.valor);
      wallet.logTx(userId, 'ESTORNO', 0, wallet.getBalance(userId), `Partida #${m.id} cancelada`, `match:${m.id}`);
    } catch (e) {
      // Flag diz que pagou mas nao ha valor travado: registra e segue, para o
      // cancelamento nao morrer no meio e deixar a partida presa em aberto.
      console.error(`[partida #${m.id}] estorno de <@${userId}> falhou: ${e.message}`);
    }
  }
  db.prepare("UPDATE matches SET status = 'CANCELADA', finished_at = ? WHERE id = ?").run(Date.now(), m.id);
});

async function cancelarPartida(client, matchId, motivo) {
  const m = get(matchId);
  if (!m || ['FINALIZADA', 'CANCELADA'].includes(m.status)) return;

  estornarAmbos(m);

  try {
    require('./analises').concluirPorMatch(matchId);
  } catch (e) {
    console.error(`[partida #${matchId}] falha ao concluir análise (B.O.):`, e.message);
  }

  try {
    await require('./filaStreamer').reseedSeNecessario(client, m);
  } catch (e) {
    console.error(`[partida #${matchId}] falha ao reassentar streamer na fila:`, e.message);
  }

  // Desfaz qualquer completa aceito: devolve a fatia de quem completou.
  let completasDesfeitos = [];
  try {
    const completar = require('./completar');
    completasDesfeitos = completar.estornarCompletas(m);
  } catch (e) {
    console.error(`[partida #${matchId}] falha ao estornar completa:`, e.message);
  }

  const thread = await client.channels.fetch(m.thread_id).catch(() => null);
  if (thread) {
    await thread.send(ui.msg(ui.bloco(cfg.COR.neutro,
      ui.titulo('🚫 PARTIDA CANCELADA'),
      ui.nota(`Partida #${matchId} · ${m.modalidade}`),
      ui.divisor(),
      ui.txt(motivo),
      ui.divisor(),
      ui.tabela([
        ['Devolvido para cada um', money.fmt(m.valor)],
        ['Taxa cobrada', money.fmt(0)],
      ]),
      ui.txt(`<@${m.p1}> e <@${m.p2}> receberam o valor de volta.`),
      completasDesfeitos.length
        ? ui.txt(`🤝 Completa(s) desfeito(s): ${completasDesfeitos.map((c) => `<@${c.completador}>`).join(', ')}.`)
        : null,
    )));
  }

  await atualizarPainel(client, matchId);

  if (thread) {
    try {
      await require('../lib/transcript').capturar(client, thread.id, 'MATCH', matchId, m.guild_id);
    } catch (e) {
      console.error(`[partida #${matchId}] falha ao capturar transcript:`, e.message);
    }
  }

  if (thread) await fecharTicket(thread, matchId, 15);
}

/** Cancelamento pelos jogadores: precisa dos dois. */
async function pedirCancelamento(interaction, matchId) {
  const m = get(matchId);
  if (!m) return nao(interaction, 'Partida não encontrada', 'Esse ticket não corresponde a nenhuma partida.');

  if (gc.hasRole(interaction.member, 'cargo_staff')) {
    await interaction.reply(ui.msg(ui.bloco(cfg.COR.aviso,
      ui.txt('⚙️ Cancelando a partida como staff...'),
    ), { efemero: true }));
    return cancelarPartida(interaction.client, matchId, `Cancelada pela staff (<@${interaction.user.id}>)`);
  }
  if (!ehJogador(m, interaction.user.id)) {
    return nao(interaction, 'Você não é jogador', 'Só os jogadores dessa partida podem cancelar.');
  }
  if (['FINALIZADA', 'CANCELADA'].includes(m.status)) {
    return nao(interaction, 'Partida encerrada', 'Essa partida já foi finalizada ou cancelada.');
  }
  if (!PODE_CANCELAR.includes(m.status)) {
    return nao(interaction, 'Partida valendo',
      'As regras já foram aceitas. A partir daqui **só a staff pode anular**.');
  }

  if (m.cancel_req && m.cancel_req !== interaction.user.id) {
    await interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
      ui.txt('✅ Cancelamento confirmado pelos dois.'),
    ), { efemero: true }));
    return cancelarPartida(interaction.client, matchId, 'Cancelamento acordado pelos dois jogadores');
  }
  if (m.cancel_req === interaction.user.id) {
    return nao(interaction, 'Já pedido', 'Você já pediu o cancelamento. Aguardando o adversário.');
  }

  db.prepare('UPDATE matches SET cancel_req = ? WHERE id = ?').run(interaction.user.id, matchId);
  await interaction.reply(ui.msg(ui.bloco(cfg.COR.aviso,
    ui.titulo('🚫 PEDIDO DE CANCELAMENTO'),
    ui.nota(`Partida #${matchId}`),
    ui.divisor(),
    ui.txt(
      `<@${interaction.user.id}> quer cancelar a partida.\n\n` +
      `<@${oponente(m, interaction.user.id)}>, clique em **CANCELAR** no painel também ` +
      'para desfazer e receber o valor de volta.'
    ),
  )));
}

module.exports = {
  get, getByThread, oponente, ehJogador, premio, painel, botoes, atualizarPainel,
  devendo, pagouTudo, cobrancaNoTicket, registrarPagamento, registrarPagamentoPorSaldo,
  botoesVeredito, fecharTicket, abrirTicket, avisarNoPv, modalRegras, proporRegras,
  confirmarRegras, recusarRegras, iniciarPartida,
  vencedorPelosClaims, recuperarResultadosPendentes, resolverAbandonos,
  selecionarVencedor, confirmarVencedor, cancelarEscolhaVencedor, chamarSuporte, chamarVarStaff,
  modalRevanche, abrirModalRevanche, proporRevanche, aceitarRevanche, recusarRevanche,
  abrirDisputa, painelSuporte,
  abrirQuebraDeRegra, registrarQuebra, recriarSala, taxaRecriacao, pedirRevisao, veredito, finalizarPartida, cancelarPartida, pedirCancelamento,
};
