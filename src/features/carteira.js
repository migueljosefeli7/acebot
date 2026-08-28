const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, AttachmentBuilder, ChannelType } = require('discord.js');

const db = require('../db/database');
const cfg = require('../config');
const ui = require('../lib/ui');
const money = require('../lib/money');
const wallet = require('../lib/wallet');
const logs = require('../lib/logs');
const gc = require('../lib/guildconfig');
const notificar = require('../lib/notificar');
const rollover = require('../lib/rollover');
const termos = require('../lib/termos');
const mp = require('../payments/mercadopago');
const emo = require('../lib/emojis');

/* ------------------------------------------------------------ PAINEL FIXO */

const painel = () => ui.bloco(cfg.COR.primaria,
  ui.titulo(`${emo.logo} CARTEIRA · ACE`),
  ui.nota('Seu saldo para entrar nas filas e apostar'),
  ui.divisor(),
  ui.txt(
    `${emo.user} **MEU PERFIL** — saldo, valor em jogo, vitórias e extrato\n` +
    `${emo.depositar} **DEPOSITAR** — gera um PIX na hora, o saldo cai automático\n` +
    `${emo.sacar} **SACAR** — retire seu saldo quando quiser\n` +
    `${emo.ticket} **VOUCHER** — resgate um código de bônus da staff`
  ),
  ui.divisor(),
  ui.tabela([
    ['Deposito minimo', money.fmt(cfg.depositoMinimo)],
    ['Saque minimo', money.fmt(cfg.saqueMinimo)],
    ['Forma de pagamento', 'PIX'],
  ]),
  ui.linhaBotoes(
    ui.botao('wallet:profile', 'MEU PERFIL', { emoji: emo.user }),
    ui.botao('wallet:deposit', 'DEPOSITAR', { emoji: emo.depositar }),
    ui.botao('wallet:withdraw', 'SACAR', { emoji: emo.sacar }),
    ui.botao('wallet:voucher', 'VOUCHER', { emoji: emo.ticket }),
  ),
  ui.nota('O valor em partida fica reservado até o resultado sair.'),
);

/* ---------------------------------------------------------------- PERFIL */

function perfil(user) {
  const elo = require('./elo');
  const u = wallet.getUser(user.id);
  const partidas = u.wins + u.losses;
  const winrate = partidas ? Math.round((u.wins / partidas) * 100) : 0;
  const eloAtual = elo.eloDe(u.pontos);
  const pos = elo.posicao(user.id);
  const roll = rollover.situacao(user.id);

  return ui.bloco(cfg.COR.primaria,
    ui.comThumb(
      [`## 👤 PERFIL DE ${(user.displayName || user.username || 'JOGADOR').toUpperCase()}`,
        `<@${user.id}>${u.banned ? '\n🚫 **Conta bloqueada para filas**' : ''}`],
      user.displayAvatarURL({ extension: 'png' }),
    ),
    ui.divisor(),
    ui.secao('💰 Carteira'),
    ui.tabela([
      ['Saldo disponivel', money.fmt(u.balance)],
      ['Saldo bonus (nao saca)', money.fmt(u.saldo_bonus)],
      ['Em jogo / reservado', money.fmt(u.locked)],
      ['Total na conta', money.fmt(u.balance + u.saldo_bonus + u.locked)],
    ]),
    ui.txt(roll.liberado
      ? '🔓 **Rollover cumprido** — você já pode sacar.'
      : `🔒 **Rollover:** ${roll.percentual}% · falta girar **${money.fmt(roll.faltaValor)}**, ` +
        `${roll.apostas}/${roll.minApostas} apostas, ${roll.adversarios}/${roll.minAdversarios} adversários`),
    ui.secao('🎯 Desempenho'),
    ui.tabela([
      ['Vitorias', String(u.wins)],
      ['Derrotas', String(u.losses)],
      ['Aproveitamento', partidas ? `${winrate}% em ${partidas} partidas` : 'sem partidas'],
    ]),
    ui.secao('🎖️ Ranqueada'),
    ui.txt(`${eloAtual.emoji} **${eloAtual.nome}** · \`${u.pontos} pontos\`` +
      (pos ? ` · **#${pos}** no ranking` : '')),
    ui.secao('📊 Histórico financeiro'),
    ui.tabela([
      ['Total depositado', money.fmt(u.total_in)],
      ['Total sacado', money.fmt(u.total_out)],
    ]),
  );
}

/**
 * Perfil PUBLICO — usado pelo +perfil no canal de completar. Nunca mostra
 * saldo/bonus/rollover: qualquer um pode ver o de qualquer um, então dado
 * financeiro fica de fora por definição (só o dono ve isso via wallet:profile).
 */
function perfilPublico(user) {
  const elo = require('./elo');
  const streak = require('./streak');
  const u = wallet.getUser(user.id);
  const partidas = u.wins + u.losses;
  const winrate = partidas ? Math.round((u.wins / partidas) * 100) : 0;
  const eloAtual = elo.eloDe(u.pontos);
  const pos = elo.posicao(user.id);

  return ui.bloco(eloAtual.cor,
    ui.comThumb(
      [`## 👤 PERFIL DE ${(user.displayName || user.username || 'JOGADOR').toUpperCase()}`,
        `<@${user.id}>${streak.tagStreak(user.id)}`],
      user.displayAvatarURL({ extension: 'png' }),
    ),
    ui.divisor(),
    ui.secao('🎯 Desempenho'),
    ui.tabela([
      ['Vitorias', String(u.wins)],
      ['Derrotas', String(u.losses)],
      ['Aproveitamento', partidas ? `${winrate}% em ${partidas} partidas` : 'sem partidas'],
    ]),
    ui.secao('🎖️ Ranqueada'),
    ui.txt(`${eloAtual.emoji} **${eloAtual.nome}** · \`${u.pontos} pontos\`` +
      (pos ? ` · **#${pos}** no ranking` : '')),
    ui.nota('Saldo é informação privada — cada um só vê o próprio em /wallet.'),
  );
}

const LABEL_TX = {
  DEPOSITO: '📥 Depósito', SAQUE: '📤 Saque', SAQUE_ESTORNO: '↩️ Saque recusado',
  APOSTA: '🎮 Aposta', PREMIO: '🏆 Prêmio', ESTORNO: '↩️ Estorno',
  TAXA: '🏦 Taxa', VOUCHER: '🎟️ Voucher',
  ADMIN_ADD: '⚙️ Saldo adicionado', ADMIN_REMOVE: '⚙️ Saldo removido',
};

function extrato(user) {
  const rows = wallet.extrato(user.id, 12);
  const linhas = rows.map((t) => {
    const sinal = t.amount > 0 ? '+' : t.amount < 0 ? '−' : ' ';
    const valor = t.amount === 0 ? '—' : `${sinal}${money.fmt(Math.abs(t.amount))}`;
    return `<t:${Math.floor(t.created_at / 1000)}:d> · ${LABEL_TX[t.type] || t.type} · **${valor}**`;
  });

  return ui.bloco(cfg.COR.neutro,
    ui.titulo('📄 ÚLTIMAS MOVIMENTAÇÕES'),
    ui.divisor(),
    ui.lista(linhas.length ? linhas : []),
    ui.nota('Mostrando as 12 mais recentes.'),
  );
}

/* -------------------------------------------------------------- DEPOSITO */

function modalDeposito() {
  return new ModalBuilder().setCustomId('wallet:deposit_modal').setTitle('Depositar via PIX')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('valor')
        .setLabel(`Valor (minimo ${money.fmt(cfg.depositoMinimo)})`)
        .setPlaceholder('Ex: 50 ou 50,00')
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(12)));
}

const erro = (titulo, texto) => ui.msg(
  ui.bloco(cfg.COR.erro, ui.titulo(`❌ ${titulo}`), ui.txt(texto)),
  { efemero: true },
);

async function gerarPix(interaction) {
  const amount = money.parse(interaction.fields.getTextInputValue('valor'));
  if (amount === null || amount <= 0) {
    return interaction.reply(erro('Valor inválido', 'Use por exemplo `50` ou `50,00`.'));
  }
  if (amount < cfg.depositoMinimo) {
    return interaction.reply(erro('Abaixo do mínimo', `O depósito mínimo é **${money.fmt(cfg.depositoMinimo)}**.`));
  }

  await interaction.deferReply({ flags: ui.EFEMERO });
  wallet.ensureUser(interaction.user.id);

  const info = db.prepare('INSERT INTO deposits (user_id, amount, created_at) VALUES (?, ?, ?)')
    .run(interaction.user.id, amount, Date.now());
  const depositId = info.lastInsertRowid;

  let pix;
  try {
    pix = await mp.criarPix({ amount, userId: interaction.user.id, username: interaction.user.username, depositId });
  } catch (e) {
    console.error('[pix] erro ao criar cobranca:', e?.message, e?.cause || '');
    db.prepare("UPDATE deposits SET status = 'CANCELADO' WHERE id = ?").run(depositId);
    return interaction.editReply(ui.msg(ui.bloco(cfg.COR.erro,
      ui.titulo('❌ Não consegui gerar o PIX'),
      ui.txt('Tente de novo em instantes. Se continuar, chame a staff.'))));
  }

  db.prepare('UPDATE deposits SET mp_payment_id = ?, qr_code = ?, ticket_url = ?, expires_at = ? WHERE id = ?')
    .run(pix.id, pix.qrCode, pix.ticketUrl, pix.expiresAt, depositId);

  const files = [];
  let galeria = null;
  if (pix.qrBase64) {
    files.push(new AttachmentBuilder(Buffer.from(pix.qrBase64, 'base64'), { name: 'pix.png' }));
    galeria = ui.imagem('attachment://pix.png');
  }

  const container = ui.bloco(cfg.COR.sucesso,
    ui.titulo('📥 PIX GERADO'),
    ui.nota(`Depósito #${depositId} · expira <t:${Math.floor(pix.expiresAt / 1000)}:R>`),
    ui.divisor(),
    ui.tabela([['Valor a pagar', money.fmt(amount)]]),
    galeria,
    ui.secao('📋 PIX copia e cola'),
    ui.txt('```\n' + pix.qrCode + '\n```'),
    ui.divisor(),
    ui.txt(pix.fake
      ? '⚠️ **MODO TESTE** — clique em `Já paguei` para simular a aprovação.'
      : '💡 O saldo cai **automaticamente** alguns segundos após o pagamento.'),
    ui.txt(`-# ${termos.linhaAviso(interaction.guildId)}`),
    ui.linhaBotoes(
      ui.botao(`wallet:check:${depositId}`, 'Já paguei', { estilo: ui.ESTILO.Success, emoji: '🔄' }),
      ui.botao(`wallet:cancel:${depositId}`, 'Cancelar'),
      pix.ticketUrl ? ui.botaoLink(pix.ticketUrl, 'Abrir no navegador', '🌐') : null,
    ),
  );

  // Registra o aceite dos termos JA no momento de gerar o PIX — e a prova
  // contra chargeback: o jogador viu o aviso antes de pagar.
  termos.registrarAceite(interaction.user.id, interaction.guildId, 'DEPOSITO', `dep:${depositId}`);

  // Canal individual de deposito: se estiver configurado, abre uma thread
  // privada so para esse deposito em vez de mandar so no efemero.
  const canalDepositos = await gc.channel(interaction.client, interaction.guildId, 'canal_depositos');
  if (canalDepositos) {
    try {
      const thread = await canalDepositos.threads.create({
        name: `💳 depósito de ${interaction.user.username}`.slice(0, 100),
        type: ChannelType.PrivateThread,
        autoArchiveDuration: 60,
        invitable: false,
        reason: `Depósito #${depositId}`,
      });
      await thread.members.add(interaction.user.id).catch(() => {});
      db.prepare('UPDATE deposits SET thread_id = ? WHERE id = ?').run(thread.id, depositId);

      await thread.send(ui.msg(container, { files }));
      return interaction.editReply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.comBotao(
          '## 📥 Seu canal de depósito está pronto',
          ui.botaoLink(`https://discord.com/channels/${interaction.guildId}/${thread.id}`, 'IR PARA O DEPÓSITO', '💳'),
        ),
      )));
    } catch (e) {
      console.error('[deposito] falha ao criar canal individual, caindo para efemero:', e.message);
    }
  }

  await interaction.editReply(ui.msg(container, { files }));
}

/**
 * Cobrança PIX de uma partida específica.
 * O valor NÃO vira saldo: ele entra direto reservado para aquela partida.
 */
async function cobrarPartida(interaction, m) {
  const partida = require('./partida');

  if (!partida.ehJogador(m, interaction.user.id)) {
    return interaction.reply(erro('Você não é jogador', 'Só os jogadores dessa partida podem pagar aqui.'));
  }
  const campo = m.p1 === interaction.user.id ? 'pago_p1' : 'pago_p2';
  if (m[campo]) {
    return interaction.reply(erro('Você já está pago', 'Seu valor nessa partida já está garantido.'));
  }
  if (m.status !== 'AGUARDANDO_PAGAMENTO') {
    return interaction.reply(erro('Fora de hora', `Essa partida não está aguardando pagamento (${m.status}).`));
  }

  await interaction.deferReply({ flags: ui.EFEMERO });

  // Se o jogador depositou saldo enquanto isso, usa o saldo e nem gera PIX.
  if (wallet.getBalance(interaction.user.id) >= m.valor) {
    await partida.registrarPagamentoPorSaldo(interaction.client, m.id, interaction.user.id, m.valor);
    return interaction.editReply(ui.msg(ui.bloco(cfg.COR.sucesso,
      ui.titulo('✅ PAGO COM SEU SALDO'),
      ui.txt(`**${money.fmt(m.valor)}** saíram do seu saldo e estão reservados nessa partida.`),
    )));
  }

  const info = db.prepare(
    "INSERT INTO deposits (user_id, amount, match_id, finalidade, created_at) VALUES (?, ?, ?, 'PARTIDA', ?)"
  ).run(interaction.user.id, m.valor, m.id, Date.now());
  const depositId = info.lastInsertRowid;

  let pix;
  try {
    pix = await mp.criarPix({
      amount: m.valor, userId: interaction.user.id,
      username: interaction.user.username, depositId,
    });
  } catch (e) {
    console.error('[pix partida] erro ao criar cobranca:', e?.message);
    db.prepare("UPDATE deposits SET status = 'CANCELADO' WHERE id = ?").run(depositId);
    return interaction.editReply(ui.msg(ui.bloco(cfg.COR.erro,
      ui.titulo('❌ Não consegui gerar o PIX'),
      ui.txt('Tente de novo em instantes ou chame a staff.'))));
  }

  db.prepare('UPDATE deposits SET mp_payment_id = ?, qr_code = ?, ticket_url = ?, expires_at = ? WHERE id = ?')
    .run(pix.id, pix.qrCode, pix.ticketUrl, pix.expiresAt, depositId);

  const files = [];
  let galeria = null;
  if (pix.qrBase64) {
    files.push(new AttachmentBuilder(Buffer.from(pix.qrBase64, 'base64'), { name: 'pix.png' }));
    galeria = ui.imagem('attachment://pix.png');
  }

  await interaction.editReply(ui.msg(ui.bloco(cfg.COR.sucesso,
    ui.titulo('💳 PIX DA PARTIDA'),
    ui.nota(`Partida #${m.id} · ${m.modalidade} · cobrança #${depositId}`),
    ui.divisor(),
    ui.tabela([
      ['Valor a pagar', money.fmt(m.valor)],
      ['Premio se vencer', money.fmt(m.valor * 2 - m.taxa)],
    ]),
    galeria,
    ui.secao('📋 PIX copia e cola'),
    ui.txt('```\n' + pix.qrCode + '\n```'),
    ui.divisor(),
    ui.txt(pix.fake
      ? '⚠️ **MODO TESTE** — clique em `Já paguei` para simular a aprovação.'
      : '💡 Assim que o pagamento cair, eu aviso no ticket automaticamente.'),
    ui.nota('Esse valor vale só para esta partida — não entra como saldo na sua conta.'),
    ui.linhaBotoes(
      ui.botao(`wallet:check:${depositId}`, 'Já paguei', { estilo: ui.ESTILO.Success, emoji: '🔄' }),
      pix.ticketUrl ? ui.botaoLink(pix.ticketUrl, 'Abrir no navegador', '🌐') : null,
    ),
  ), { files }));
}

/**
 * Abre automaticamente a cobrança da revanche para quem não tem saldo.
 * O PIX é vinculado à nova partida e, quando aprovado, já entra reservado.
 */
async function criarCobrancaPartidaAutomatica(client, m, userId) {
  const campo = m.p1 === userId ? 'pago_p1' : m.p2 === userId ? 'pago_p2' : null;
  if (!campo || m[campo] || m.status !== 'AGUARDANDO_PAGAMENTO') return null;

  const existente = db.prepare(
    `SELECT * FROM deposits
     WHERE match_id = ? AND user_id = ? AND finalidade = 'PARTIDA' AND status = 'PENDENTE'
     ORDER BY id DESC LIMIT 1`
  ).get(m.id, userId);

  const ticketPartida = await client.channels.fetch(m.thread_id).catch(() => null);
  if (existente) {
    if (existente.thread_id && ticketPartida) {
      await ticketPartida.send(ui.msg(ui.bloco(cfg.COR.aviso,
        ui.comBotao(
          `<@${userId}>, sua cobrança da revanche já está aberta.`,
          ui.botaoLink(
            `https://discord.com/channels/${m.guild_id}/${existente.thread_id}`,
            'IR PARA O DEPÓSITO',
            '💳',
          ),
        ),
      ))).catch(() => {});
    }
    return existente;
  }

  const user = await client.users.fetch(userId);
  const info = db.prepare(
    "INSERT INTO deposits (user_id, amount, match_id, finalidade, created_at) VALUES (?, ?, ?, 'PARTIDA', ?)"
  ).run(userId, m.valor, m.id, Date.now());
  const depositId = Number(info.lastInsertRowid);

  let pix;
  try {
    pix = await mp.criarPix({
      amount: m.valor, userId, username: user.username, depositId,
    });
  } catch (e) {
    db.prepare("UPDATE deposits SET status = 'CANCELADO' WHERE id = ?").run(depositId);
    if (ticketPartida) {
      await ticketPartida.send(ui.msg(ui.bloco(cfg.COR.erro,
        ui.titulo('❌ NÃO CONSEGUI GERAR O PIX'),
        ui.txt(`<@${userId}>, tente novamente pelo botão **PAGAR MINHA PARTIDA** ou chame a staff.`),
      ))).catch(() => {});
    }
    throw e;
  }

  db.prepare('UPDATE deposits SET mp_payment_id = ?, qr_code = ?, ticket_url = ?, expires_at = ? WHERE id = ?')
    .run(pix.id, pix.qrCode, pix.ticketUrl, pix.expiresAt, depositId);

  const files = [];
  let galeria = null;
  if (pix.qrBase64) {
    files.push(new AttachmentBuilder(Buffer.from(pix.qrBase64, 'base64'), { name: 'pix.png' }));
    galeria = ui.imagem('attachment://pix.png');
  }

  const container = ui.bloco(cfg.COR.primaria,
    ui.titulo('💳 PIX DA REVANCHE'),
    ui.nota(`Partida #${m.id} · cobrança #${depositId}`),
    ui.divisor(),
    ui.tabela([
      ['Valor a pagar', money.fmt(m.valor)],
      ['Prêmio se vencer', money.fmt(m.valor * 2 - m.taxa)],
    ]),
    galeria,
    ui.secao('📋 PIX copia e cola'),
    ui.txt('```\n' + pix.qrCode + '\n```'),
    ui.divisor(),
    ui.txt(pix.fake
      ? '⚠️ **MODO TESTE** — clique em `Já paguei` para simular a aprovação.'
      : '💡 Assim que o pagamento cair, a revanche começa automaticamente.'),
    ui.txt(`-# ${termos.linhaAviso(m.guild_id)}`),
    ui.linhaBotoes(
      ui.botao(`wallet:check:${depositId}`, 'Já paguei', { estilo: ui.ESTILO.Success, emoji: '🔄' }),
      pix.ticketUrl ? ui.botaoLink(pix.ticketUrl, 'Abrir no navegador', '🌐') : null,
    ),
  );

  termos.registrarAceite(userId, m.guild_id, 'DEPOSITO', `dep:${depositId}`);

  const canalDepositos = await gc.channel(client, m.guild_id, 'canal_depositos');
  if (canalDepositos) {
    try {
      const thread = await canalDepositos.threads.create({
        name: `💳 revanche de ${user.username}`.slice(0, 100),
        type: ChannelType.PrivateThread,
        autoArchiveDuration: 60,
        invitable: false,
        reason: `Pagamento da revanche #${m.id} · depósito #${depositId}`,
      });
      await thread.members.add(userId).catch(() => {});
      db.prepare('UPDATE deposits SET thread_id = ? WHERE id = ?').run(thread.id, depositId);
      await thread.send(ui.msg(container, { files }));

      if (ticketPartida) {
        await ticketPartida.send(ui.msg(ui.bloco(cfg.COR.primaria,
          ui.comBotao(
            `<@${userId}>, seu canal de depósito da revanche está pronto.`,
            ui.botaoLink(
              `https://discord.com/channels/${m.guild_id}/${thread.id}`,
              'IR PARA O DEPÓSITO',
              '💳',
            ),
          ),
        ))).catch(() => {});
      }
      return { id: depositId, threadId: thread.id };
    } catch (e) {
      console.error('[revanche] falha ao criar canal de depósito:', e.message);
    }
  }

  // Fallback seguro: não perde a cobrança se o canal não estiver configurado.
  await user.send(ui.msg(container, { files })).catch(() => {});
  if (ticketPartida) {
    await ticketPartida.send(ui.msg(ui.bloco(cfg.COR.aviso,
      ui.titulo('⚠️ CANAL DE DEPÓSITO INDISPONÍVEL'),
      ui.txt(`<@${userId}>, enviei o PIX no seu privado. A staff deve conferir a configuração de **canal_depositos**.`),
    ))).catch(() => {});
  }
  return { id: depositId, threadId: null };
}

/**
 * Confirma um deposito e credita. Idempotente: se ja foi pago, nao credita de novo.
 * Usado pelo webhook do Mercado Pago e pelo botao "Ja paguei".
 *
 * finalidade SALDO   -> vira saldo livre na conta.
 * finalidade PARTIDA -> entra reservado direto naquela partida, nunca como saldo.
 */
async function confirmarDeposito(client, depositId, { guildId } = {}) {
  const dep = db.prepare('SELECT * FROM deposits WHERE id = ?').get(depositId);
  if (!dep) return { ok: false, motivo: 'NAO_ENCONTRADO' };
  if (dep.status === 'PAGO') return { ok: true, jaCreditado: true, deposit: dep };
  if (dep.status !== 'PENDENTE') return { ok: false, motivo: dep.status };

  const marcou = db.prepare("UPDATE deposits SET status = 'PAGO', paid_at = ? WHERE id = ? AND status = 'PENDENTE'")
    .run(Date.now(), depositId);
  if (marcou.changes === 0) return { ok: true, jaCreditado: true, deposit: dep };

  if (dep.finalidade === 'PARTIDA' && dep.match_id) {
    const partida = require('./partida');
    await partida.registrarPagamento(client, dep.match_id, dep.user_id, dep.amount);
    await logs.deposito(client, guildId || cfg.guildId, {
      userId: dep.user_id, amount: dep.amount, saldo: wallet.getBalance(dep.user_id),
      metodo: `PIX · partida #${dep.match_id}`, ref: dep.mp_payment_id,
    });
    return { ok: true, jaCreditado: false, deposit: dep, partida: true };
  }

  const saldo = wallet.credit(dep.user_id, dep.amount, 'DEPOSITO', 'Depósito via PIX', `dep:${depositId}`);

  const gid = guildId || cfg.guildId;
  await logs.deposito(client, gid, {
    userId: dep.user_id, amount: dep.amount, saldo, metodo: 'PIX', ref: dep.mp_payment_id,
  });

  const confirmacao = ui.bloco(cfg.COR.sucesso,
    ui.titulo('✅ DEPÓSITO CONFIRMADO'),
    ui.divisor(),
    ui.tabela([
      ['Valor creditado', money.fmt(dep.amount)],
      ['Saldo atual', money.fmt(saldo)],
    ]),
    ui.nota('Já pode entrar na fila.'),
  );

  try {
    const user = await client.users.fetch(dep.user_id);
    await user.send(ui.msg(confirmacao));
  } catch { /* DM fechada */ }

  // Canal individual de deposito: confirma ali dentro e fecha o canal.
  if (dep.thread_id) {
    try {
      const thread = await client.channels.fetch(dep.thread_id);
      if (thread) {
        // Transcript: prova contra chargeback, capturada antes de trancar o canal.
        await require('../lib/transcript').capturar(client, thread.id, 'DEPOSITO', depositId, guildId || cfg.guildId)
          .catch((e) => console.error(`[deposito #${depositId}] falha ao capturar transcript:`, e.message));
        await fecharCanalDeposito(thread, confirmacao);
      }
    } catch (e) {
      console.error(`[deposito #${depositId}] falha ao fechar canal:`, e.message);
    }
  }

  return { ok: true, jaCreditado: false, deposit: dep, saldo };
}

/** Confirma no canal individual e fecha em seguida — mesmo padrao dos tickets de partida. */
async function fecharCanalDeposito(thread, confirmacao) {
  await thread.send(ui.msg(confirmacao)).catch(() => {});
  await thread.send(ui.msg(ui.bloco(cfg.COR.neutro,
    ui.txt('🔒 Este canal será fechado em 20 segundos.'),
  ))).catch(() => {});

  setTimeout(async () => {
    try {
      await thread.setLocked(true);
      await thread.setArchived(true);
    } catch (e) {
      console.error('[deposito] não consegui fechar o canal individual:', e.message);
    }
  }, 20_000);
}

async function checarDeposito(interaction, depositId) {
  await interaction.deferReply({ flags: ui.EFEMERO });
  const dep = db.prepare('SELECT * FROM deposits WHERE id = ? AND user_id = ?').get(depositId, interaction.user.id);

  const responder = (cor, titulo, texto) =>
    interaction.editReply(ui.msg(ui.bloco(cor, ui.titulo(titulo), ui.txt(texto))));

  if (!dep) return responder(cfg.COR.erro, '❌ Depósito não encontrado', 'Gere um novo PIX no painel.');
  if (dep.status === 'PAGO') {
    return responder(cfg.COR.sucesso, '✅ Já creditado',
      `Saldo atual: **${money.fmt(wallet.getBalance(interaction.user.id))}**`);
  }

  if (!cfg.fakePayments) {
    try {
      const r = await mp.consultar(dep.mp_payment_id);
      if (r.status !== 'approved') {
        return responder(cfg.COR.aviso, '⏳ Pagamento ainda não identificado',
          'Se você já pagou, aguarde alguns segundos e clique de novo.');
      }
    } catch (e) {
      console.error('[pix] consulta falhou:', e.message);
      return responder(cfg.COR.aviso, '⚠️ Não consegui consultar agora', 'Tente novamente em instantes.');
    }
  }

  const r = await confirmarDeposito(interaction.client, depositId, { guildId: interaction.guildId });
  if (!r.ok) return responder(cfg.COR.erro, '❌ Não foi possível confirmar', 'Chame a staff informando o número do depósito.');

  return responder(cfg.COR.sucesso, '✅ Depósito confirmado',
    `Saldo atual: **${money.fmt(wallet.getBalance(interaction.user.id))}**`);
}

/* ----------------------------------------------------------------- SAQUE */

function modalSaque(saldo) {
  return new ModalBuilder().setCustomId('wallet:withdraw_modal').setTitle('Solicitar saque')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('valor')
          .setLabel(`Valor (disponivel: ${money.fmt(saldo)})`)
          .setPlaceholder(`Minimo ${money.fmt(cfg.saqueMinimo)}`)
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(12)),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('chave').setLabel('Sua chave PIX')
          .setPlaceholder('CPF, telefone, e-mail ou aleatoria')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('titular').setLabel('Nome do titular da chave')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)),
    );
}

async function solicitarSaque(interaction) {
  const amount = money.parse(interaction.fields.getTextInputValue('valor'));
  const chave = interaction.fields.getTextInputValue('chave').trim();
  const titular = interaction.fields.getTextInputValue('titular').trim();

  if (amount === null || amount <= 0) return interaction.reply(erro('Valor inválido', 'Use `50` ou `50,00`.'));
  if (amount < cfg.saqueMinimo) {
    return interaction.reply(erro('Abaixo do mínimo', `O saque mínimo é **${money.fmt(cfg.saqueMinimo)}**.`));
  }

  const pendente = db.prepare("SELECT COUNT(*) c FROM withdrawals WHERE user_id = ? AND status = 'PENDENTE'")
    .get(interaction.user.id).c;
  if (pendente > 0) {
    return interaction.reply(erro('Saque já pendente', 'Você já tem um saque aguardando. Espere a staff processar.'));
  }

  // Rollover (PLD/FT): sem girar o que entrou, nao saca. Sem isso o bot vira
  // rota de saida de dinheiro que nunca passou por uma partida.
  if (!rollover.situacao(interaction.user.id).liberado) {
    return interaction.reply(ui.msg(rollover.painel(interaction.user.id), { efemero: true }));
  }

  try {
    // Saque nunca encosta no bonus: so no saldo real.
    wallet.lock(interaction.user.id, amount, { usarBonus: false });
  } catch {
    return interaction.reply(erro('Saldo insuficiente',
      `Disponível: **${money.fmt(wallet.getBalance(interaction.user.id))}**`));
  }

  const info = db.prepare('INSERT INTO withdrawals (user_id, amount, pix_key, holder_name, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(interaction.user.id, amount, chave, titular, Date.now());
  const id = info.lastInsertRowid;

  await interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
    ui.titulo('📤 SAQUE SOLICITADO'),
    ui.nota(`Saque #${id}`),
    ui.divisor(),
    ui.tabela([
      ['Valor', money.fmt(amount)],
      ['Chave PIX', chave],
      ['Titular', titular],
      ['Saldo restante', money.fmt(wallet.getBalance(interaction.user.id))],
    ]),
    ui.txt('O valor foi **reservado** da sua conta. A staff processa e você recebe no PIX.'),
  ), { efemero: true }));

  const ch = await gc.channel(interaction.client, interaction.guildId, 'canal_saques_staff');
  if (!ch) return console.warn('[saque] canal_saques_staff nao configurado');

  const cargoStaff = gc.get(interaction.guildId, 'cargo_staff');
  const msg = await ch.send(ui.msg(ui.bloco(cfg.COR.aviso,
    ui.titulo(`📤 SAQUE #${id} · AGUARDANDO APROVAÇÃO`),
    ui.txt(`${cargoStaff ? `<@&${cargoStaff}> · ` : ''}Jogador: <@${interaction.user.id}>`),
    ui.divisor(),
    ui.tabela([
      ['Valor a pagar', money.fmt(amount)],
      ['Titular', titular],
      ['Chave PIX', chave],
      ['ID do jogador', interaction.user.id],
      ['Saldo restante', money.fmt(wallet.getBalance(interaction.user.id))],
    ]),
    ui.divisor(),
    ui.txt('Faça o PIX manualmente e só então aprove aqui.'),
    ui.linhaBotoes(
      ui.botao(`wd:approve:${id}`, 'APROVAR E PAGAR', { estilo: ui.ESTILO.Success, emoji: '✅' }),
      ui.botao(`wd:deny:${id}`, 'RECUSAR', { estilo: ui.ESTILO.Danger, emoji: '❌' }),
    ),
  )));
  db.prepare('UPDATE withdrawals SET message_id = ? WHERE id = ?').run(msg.id, id);

  await notificar.chamarCargo(interaction.client, interaction.guildId, 'cargo_staff', {
    titulo: '📤 SAQUE AGUARDANDO APROVAÇÃO',
    descricao: `**Saque #${id}** — <@${interaction.user.id}>\n\nO valor já está reservado da conta do jogador.`,
    dados: [
      ['Valor a pagar', money.fmt(amount)],
      ['Titular', titular],
      ['Chave PIX', chave],
    ],
    canalId: ch.id,
    rotuloBotao: 'IR PARA A SOLICITAÇÃO',
  });
}

async function resolverSaque(interaction, id, aprovado, motivo) {
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
  if (!w) return interaction.reply(erro('Saque não encontrado', `Não existe saque #${id}.`));
  if (w.status !== 'PENDENTE') {
    return interaction.reply(erro('Já resolvido', `Esse saque já está como **${w.status}**.`));
  }

  if (aprovado) {
    wallet.consumeLocked(w.user_id, w.amount, 'SAQUE', `Saque #${id} pago via PIX`, `wd:${id}`, { usarBonus: false });
  } else {
    wallet.unlock(w.user_id, w.amount, { usarBonus: false });
    wallet.logTx(w.user_id, 'SAQUE_ESTORNO', 0, wallet.getBalance(w.user_id), `Saque #${id} recusado`, `wd:${id}`);
  }

  db.prepare('UPDATE withdrawals SET status = ?, staff_id = ?, reason = ?, resolved_at = ? WHERE id = ?')
    .run(aprovado ? 'PAGO' : 'RECUSADO', interaction.user.id, motivo || null, Date.now(), id);

  // Mensagem V2 é reescrita inteira: sem botões e com o desfecho registrado.
  await interaction.update(ui.msg(ui.bloco(aprovado ? cfg.COR.sucesso : cfg.COR.erro,
    ui.titulo(`📤 SAQUE #${id} · ${aprovado ? 'PAGO' : 'RECUSADO'}`),
    ui.txt(`Jogador: <@${w.user_id}> · Resolvido por <@${interaction.user.id}>`),
    ui.divisor(),
    ui.tabela([
      ['Valor', money.fmt(w.amount)],
      ['Titular', w.holder_name || '—'],
      ['Chave PIX', w.pix_key],
    ]),
    motivo ? ui.txt(`**Motivo:** ${motivo}`) : null,
    ui.nota(aprovado ? 'Valor debitado em definitivo.' : 'Valor devolvido ao saldo do jogador.'),
  )));

  await logs.saque(interaction.client, interaction.guildId, {
    userId: w.user_id, amount: w.amount, status: aprovado ? 'PAGO' : 'RECUSADO',
    staffId: interaction.user.id, pixKey: w.pix_key, motivo, id,
  });

  // Log publico so quando o saque realmente sai — recusado nao anuncia nada.
  if (aprovado) {
    await logs.saquePublico(interaction.client, interaction.guildId, { userId: w.user_id, amount: w.amount });
  }

  try {
    const user = await interaction.client.users.fetch(w.user_id);
    await user.send(ui.msg(ui.bloco(aprovado ? cfg.COR.sucesso : cfg.COR.erro,
      ui.titulo(aprovado ? '✅ SAQUE PAGO' : '❌ SAQUE RECUSADO'),
      ui.divisor(),
      ui.tabela([['Valor', money.fmt(w.amount)], ['Chave PIX', w.pix_key]]),
      ui.txt(aprovado
        ? 'O PIX foi enviado para a chave acima.'
        : `O valor **voltou para o seu saldo**.${motivo ? `\n\n**Motivo:** ${motivo}` : ''}`),
      ui.nota(`Saque #${id}`),
    )));
  } catch { /* DM fechada */ }
}

module.exports = {
  painel, perfil, perfilPublico, extrato, erro, cobrarPartida,
  criarCobrancaPartidaAutomatica,
  modalDeposito, gerarPix, confirmarDeposito, checarDeposito,
  modalSaque, solicitarSaque, resolverSaque,
};
