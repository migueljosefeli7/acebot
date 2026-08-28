const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

const cfg = require('./config');
const ui = require('./lib/ui');
const wallet = require('./lib/wallet');
const gc = require('./lib/guildconfig');
const ratelimit = require('./lib/ratelimit');
const carteira = require('./features/carteira');
const fila = require('./features/fila');
const voucher = require('./features/voucher');
const partida = require('./features/partida');
const elo = require('./features/elo');
const ranking = require('./features/ranking');
const loja = require('./features/loja');
const sugestao = require('./features/sugestao');
const completar = require('./features/completar');
const caixas = require('./features/caixas');
const eventos = require('./features/eventos');
const streamers = require('./features/streamers');
const money = require('./lib/money');

const nao = (interaction, titulo, texto) => interaction.reply(ui.msg(
  ui.bloco(cfg.COR.erro, ui.titulo(`❌ ${titulo}`), ui.txt(texto)),
  { efemero: true },
));

/* -------------------------------------------------------------------- FILA */

async function entrarFila(interaction, queueId, gelo) {
  // Recusa ANTES de travar saldo: se o Discord esta limitando, a partida nao
  // conseguiria abrir o ticket e o jogador ficaria com o valor presa a toa.
  if (ratelimit.estaPausado()) return interaction.reply(ratelimit.respostaPausado());

  const r = fila.entrarNaFila(queueId, interaction.user.id, gelo);

  if (r.erro === 'BANIDO') return nao(interaction, 'Conta bloqueada', 'Sua conta está bloqueada para filas. Fale com a staff.');
  if (r.erro === 'FILA_INATIVA') return nao(interaction, 'Fila encerrada', 'Essa fila não está mais ativa.');
  if (r.erro === 'JA_NA_FILA') return nao(interaction, 'Você já está aqui', 'Já está nessa fila nesse modo. Clique em `Sair` para desistir.');
  if (r.erro === 'STREAMER_OFFLINE') return nao(interaction, 'Streamer não está disponível', 'Ele saiu da fila (ficou offline ou está em outra partida). Aguarde ele voltar.');
  if (r.erro === 'EM_PARTIDA') {
    const m = partida.get(r.matchId);
    return interaction.reply(ui.msg(ui.bloco(cfg.COR.erro,
      ui.titulo('❌ Partida em aberto'),
      ui.txt(`Termine a partida #${r.matchId} antes de entrar em outra fila.`),
      m?.thread_id ? ui.comBotao(
        '**Volte ao ticket para concluir o resultado.**',
        ui.botaoLink(
          `https://discord.com/channels/${interaction.guildId}/${m.thread_id}`,
          'ABRIR PARTIDA',
          '⚔️',
        ),
      ) : null,
    ), { efemero: true }));
  }
  if (!r.ok) return nao(interaction, 'Não consegui te colocar na fila', 'Tente de novo em instantes.');

  // Entrou com saldo: sem pop-up, o painel já mostra quem está na fila.
  // Entrou sem saldo: é o único caso que merece aviso, explicando que vai
  // pagar aquela partida dentro do ticket.
  if (r.pago) await interaction.deferUpdate();
  else await interaction.reply(fila.semSaldoResposta(r.falta, r.saldo, r.queue.valor));

  if (r.filaAnterior) await fila.atualizarPainel(interaction.client, r.filaAnterior);
  await fila.atualizarPainel(interaction.client, queueId);

  if (!r.matchId) return;

  // Fechou partida: o ticket e a DM avisam os dois jogadores.
  const thread = await partida.abrirTicket(interaction.client, r.matchId);
  if (!thread) {
    await partida.cancelarPartida(interaction.client, r.matchId, 'Erro ao abrir o ticket (canal de tickets não configurado)');
    return interaction.followUp(ui.msg(ui.bloco(cfg.COR.erro,
      ui.titulo('❌ Não consegui abrir o ticket'),
      ui.txt('Avise a staff: o **canal de tickets** não está configurado. Seu valor foi devolvido.'),
    ), { efemero: true }));
  }
}

async function sairFila(interaction, queueId) {
  const r = fila.sairDaFila(queueId, interaction.user.id);
  if (r.erro) return nao(interaction, 'Você não está na fila', 'Não encontrei você nessa fila.');

  // Saiu: também sem pop-up, o painel reflete na hora.
  await interaction.deferUpdate();
  return fila.atualizarPainel(interaction.client, queueId);
}

/* ----------------------------------------------------------------- BOTOES */

async function onButton(interaction) {
  const [ns, acao, a, b, c] = interaction.customId.split(':');

  if (ns === 'wallet') {
    switch (acao) {
      case 'deposit': return interaction.showModal(carteira.modalDeposito());
      case 'withdraw': return interaction.showModal(carteira.modalSaque(wallet.getBalance(interaction.user.id)));
      case 'voucher': return interaction.showModal(voucher.modalResgate());
      case 'profile':
        return interaction.reply(ui.msg(
          [carteira.perfil(interaction.user), carteira.extrato(interaction.user)],
          { efemero: true },
        ));
      case 'check': return carteira.checarDeposito(interaction, Number(a));
      case 'cancel':
        require('./db/database')
          .prepare("UPDATE deposits SET status = 'CANCELADO' WHERE id = ? AND user_id = ? AND status = 'PENDENTE'")
          .run(Number(a), interaction.user.id);
        return interaction.update(ui.msg(ui.bloco(cfg.COR.neutro,
          ui.titulo('🚫 COBRANÇA CANCELADA'),
          ui.txt('Gere um novo PIX quando quiser depositar.'),
        )));
    }
  }

  if (ns === 'wd') {
    if (!gc.hasRole(interaction.member, 'cargo_staff')) {
      return nao(interaction, 'Sem permissão', 'Só a staff pode resolver saques.');
    }
    if (acao === 'approve') return carteira.resolverSaque(interaction, Number(a), true);
    if (acao === 'deny') {
      return interaction.showModal(new ModalBuilder().setCustomId(`wd:deny_modal:${a}`).setTitle('Recusar saque')
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('motivo').setLabel('Motivo da recusa')
            .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(400))));
    }
  }

  if (ns === 'queue') {
    if (acao === 'join') return entrarFila(interaction, Number(a), b);
    if (acao === 'leave') return sairFila(interaction, Number(a));
  }

  if (ns === 'rank') {
    if (acao === 'meu') return interaction.reply(ui.msg(elo.painelElo(interaction.user), { efemero: true }));
    if (acao === 'atualizar') {
      await ranking.atualizarPainel(interaction.client, interaction.guildId);
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('🔄 RANKING ATUALIZADO'),
        ui.txt('O painel acima já está com os números de agora.'),
      ), { efemero: true }));
    }
  }

  if (ns === 'loja') {
    if (acao === 'meus') {
      return interaction.reply(ui.msg(loja.meusPedidos(interaction.user.id), { efemero: true }));
    }
    if (acao === 'entregue' || acao === 'cancelar') {
      if (!gc.hasRole(interaction.member, 'cargo_staff')) {
        return nao(interaction, 'Sem permissão', 'Só a staff resolve pedidos da loja.');
      }
      return loja.resolverPedido(interaction, Number(a), acao === 'entregue');
    }
  }

  if (ns === 'suggestion' && acao === 'vote') {
    return sugestao.processarVoto(interaction, Number(a), b);
  }

  if (ns === 'completa') {
    const completaId = Number(a);

    if (acao === 'como') {
      const c = completar.getPorId(completaId);
      if (!c) return nao(interaction, 'Convite não encontrado', 'Esse convite não existe mais.');
      return interaction.reply(ui.msg(completar.textoComoFunciona(c), { efemero: true }));
    }

    if (acao === 'sim') {
      const r = completar.aceitar(completaId, interaction.user.id);
      if (r.erro === 'NAO_E_O_ALVO') return nao(interaction, 'Não é para você', 'Só o dono da partida (quem tem a fila puxada) pode aceitar.');
      if (r.erro === 'JA_RESOLVIDO') return nao(interaction, 'Já resolvido', 'Esse convite já foi respondido.');
      if (r.erro === 'SEM_SALDO') return nao(interaction, 'Saldo insuficiente', 'Quem está completando não tem mais saldo real suficiente.');
      if (!r.ok) return nao(interaction, 'Não consegui processar', 'Tente de novo em instantes.');

      return interaction.update(ui.msg(completar.painelConvite(partida.get(r.completa.match_id), r.completa)));
    }

    if (acao === 'nao') {
      const r = completar.recusar(completaId, interaction.user.id);
      if (r.erro === 'NAO_E_O_ALVO') return nao(interaction, 'Não é para você', 'Só o dono da partida (quem tem a fila puxada) pode recusar.');
      if (r.erro === 'JA_RESOLVIDO') return nao(interaction, 'Já resolvido', 'Esse convite já foi respondido.');

      const c = completar.getPorId(completaId);
      return interaction.update(ui.msg(completar.painelConvite(partida.get(c.match_id), c)));
    }
  }

  if (ns === 'streamer') {
    const alvoId = a;
    if (interaction.user.id !== alvoId) {
      return nao(interaction, 'Não é seu painel', 'Só o próprio streamer pode usar os botões desse painel.');
    }
    if (acao === 'aovivo') return interaction.showModal(streamers.modalAoVivo(alvoId));
    if (acao === 'offline') return streamers.acaoOffline(interaction, alvoId);
    if (acao === 'abrirfila') return interaction.showModal(streamers.modalAbrirFila(alvoId));
    if (acao === 'fecharfila') return streamers.acaoFecharFila(interaction, alvoId);
  }

  if (ns === 'evento') {
    if (acao === 'meu') {
      return interaction.reply(ui.msg(eventos.painelMeuProgresso(interaction.guildId, interaction.user.id), { efemero: true }));
    }
    if (acao === 'atualizar') {
      await eventos.publicarPainel(interaction.client, interaction.guildId).catch(() => {});
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.sucesso,
        ui.titulo('🔄 PAINEL ATUALIZADO'),
        ui.txt('O painel acima já está com os eventos de agora.'),
      ), { efemero: true }));
    }
  }

  if (ns === 'caixa' && acao === 'abrir') {
    const id = Number(a);
    const r = caixas.abrir(interaction.guildId, id, interaction.user.id);

    if (r.erro === 'NAO_EXISTE') return nao(interaction, 'Caixa não encontrada', `Não existe caixa #${id} neste servidor.`);
    if (r.erro === 'INATIVA') return nao(interaction, 'Caixa desativada', 'Essa caixa não está mais disponível.');
    if (r.erro === 'SEM_PREMIOS') return nao(interaction, 'Caixa sem prêmios', 'Essa caixa ainda não tem prêmios cadastrados. Avise a staff.');
    if (r.erro === 'SEM_PONTOS') {
      return interaction.reply(ui.msg(ui.bloco(cfg.COR.erro,
        ui.titulo('❌ PONTOS INSUFICIENTES'),
        ui.divisor(),
        ui.tabela([['Seus pontos', String(r.pontos)], ['Falta', String(r.falta)]]),
      ), { efemero: true }));
    }
    return interaction.reply(ui.msg(caixas.painelResultado(r.caixa, r.premio, r.pontosDepois)));
  }

  if (ns === 'match') {
    const id = Number(a);
    switch (acao) {
      case 'rules': {
        const m = partida.get(id);
        if (!m || !partida.ehJogador(m, interaction.user.id)) {
          return nao(interaction, 'Você não é jogador', 'Só os jogadores dessa partida podem combinar as regras.');
        }
        return interaction.showModal(partida.modalRegras(id));
      }
      case 'rules_confirm': return partida.confirmarRegras(interaction, id);
      case 'rules_change': {
        const m = partida.get(id);
        if (!m || !partida.ehJogador(m, interaction.user.id)) {
          return nao(interaction, 'Você não é jogador', 'Só os jogadores dessa partida podem propor regras.');
        }
        if (m.regras_autor === interaction.user.id) {
          return nao(interaction, 'Espere o adversário', 'Você já propôs a regra atual.');
        }
        return interaction.showModal(partida.modalRegras(id, 'match:rules_change_modal'));
      }
      case 'rules_refuse': return partida.recusarRegras(interaction, id);
      case 'room': return partida.iniciarPartida(interaction, id);
      case 'pay': {
        const m = partida.get(id);
        if (!m) return nao(interaction, 'Partida não encontrada', 'Esse ticket não corresponde a nenhuma partida.');
        return carteira.cobrarPartida(interaction, m);
      }
      case 'support': return partida.chamarSuporte(interaction, id);
      case 'staff_var': return partida.chamarVarStaff(interaction, id);
      case 'winner_confirm': return partida.confirmarVencedor(interaction, id, b, c);
      case 'winner_cancel': return partida.cancelarEscolhaVencedor(interaction, id, b);
      case 'rematch': return partida.abrirModalRevanche(interaction, id);
      case 'rematch_accept': return partida.aceitarRevanche(interaction, id);
      case 'rematch_decline': return partida.recusarRevanche(interaction, id);
      // Compatibilidade com mensagens antigas: o antigo botão de quebra/tela
      // agora dispara o mesmo SOS, sem permitir que jogador chame VAR.
      case 'quebra': return partida.chamarSuporte(interaction, id);
      case 'recriar': return partida.recriarSala(interaction, id);
      case 'revisao': return partida.chamarSuporte(interaction, id);
      case 'ss':
      case 'ss_ok': return partida.chamarSuporte(interaction, id);
      case 'ss_no':
        return interaction.update(ui.msg(ui.bloco(cfg.COR.neutro,
          ui.titulo('ℹ️ FLUXO ATUALIZADO'),
          ui.txt('Jogadores não chamam mais VAR. Use **CHAMAR SUPORTE** para enviar um SOS à staff.'),
        )));
      case 'verdict': return partida.veredito(interaction, id, b);
      case 'staffcancel': {
        if (!gc.hasRole(interaction.member, 'cargo_staff') && !gc.hasRole(interaction.member, 'cargo_staff_ss')) {
          return nao(interaction, 'Sem permissão', 'Só a staff pode anular a partida.');
        }
        await interaction.update(ui.msg(ui.bloco(cfg.COR.neutro,
          ui.titulo('🚫 PARTIDA ANULADA'),
          ui.txt(`Anulada por <@${interaction.user.id}>. Devolvendo o valor aos dois jogadores.`),
        )));
        return partida.cancelarPartida(interaction.client, id, `Anulada pela staff (<@${interaction.user.id}>)`);
      }
      case 'cancel': return partida.pedirCancelamento(interaction, id);
    }
  }
}

/* ------------------------------------------------------------ MENU DA LOJA */

async function onSelect(interaction) {
  const [ns, acao, id] = interaction.customId.split(':');
  if (ns === 'match' && acao === 'winner') {
    return partida.selecionarVencedor(interaction, Number(id), interaction.values[0]);
  }
  if (ns !== 'loja' || acao !== 'comprar') return;

  const itemId = Number(interaction.values[0]);
  const r = loja.comprar(interaction.guildId, itemId, interaction.user.id);

  if (r.erro === 'SEM_PONTOS') {
    return interaction.reply(ui.msg(ui.bloco(cfg.COR.erro,
      ui.titulo('❌ PONTOS INSUFICIENTES'),
      ui.divisor(),
      ui.tabela([
        ['Seus pontos', String(r.pontos)],
        ['Falta', String(r.falta)],
      ]),
      ui.txt('Vença partidas para ganhar pontos.'),
    ), { efemero: true }));
  }
  if (r.erro === 'SEM_ESTOQUE') return nao(interaction, 'Esgotado', 'Esse item acabou de sair de estoque.');
  if (r.erro === 'ITEM_INATIVO' || r.erro === 'ITEM_INEXISTENTE') {
    return nao(interaction, 'Item indisponível', 'Esse item não está mais na loja.');
  }
  if (r.erro === 'MUITOS_PEDIDOS') {
    return nao(interaction, 'Pedidos demais', `Você já tem ${r.pendentes} pedidos aguardando entrega. Espere a staff.`);
  }
  if (!r.ok) return nao(interaction, 'Não consegui registrar', 'Tente de novo em instantes.');

  await interaction.deferReply({ flags: ui.EFEMERO });
  const thread = await loja.abrirPedido(interaction.client, interaction.guildId, r.pedidoId);
  await loja.atualizarPainel(interaction.client, interaction.guildId);

  if (!thread) {
    return interaction.editReply(ui.msg(ui.bloco(cfg.COR.aviso,
      ui.titulo('⚠️ PEDIDO REGISTRADO, MAS SEM TICKET'),
      ui.txt('Avise a staff: o canal de pedidos da loja não está configurado.'),
      ui.nota(`Pedido #${r.pedidoId} · seus pontos já foram debitados.`),
    )));
  }

  return interaction.editReply(ui.msg(ui.bloco(cfg.COR.sucesso,
    ui.titulo('🛒 RESGATE FEITO!'),
    ui.divisor(),
    ui.tabela([
      ['Item', r.item.nome],
      ['Custo', `${r.item.preco} pontos`],
      ['Pontos restantes', String(r.pontosDepois)],
    ]),
    ui.divisor(),
    ui.comBotao(
      '**A staff foi avisada.** Entre no ticket e informe seus dados.',
      ui.botaoLink(`https://discord.com/channels/${interaction.guildId}/${thread.id}`, 'IR PARA O PEDIDO', '📦'),
    ),
  )));
}

/* ----------------------------------------------------------------- MODAIS */

async function onModal(interaction) {
  const [ns, acao, a, b] = interaction.customId.split(':');

  if (ns === 'wallet') {
    if (acao === 'deposit_modal') return carteira.gerarPix(interaction);
    if (acao === 'withdraw_modal') return carteira.solicitarSaque(interaction);
    if (acao === 'voucher_modal') return voucher.processarResgate(interaction);
  }
  if (ns === 'wd' && acao === 'deny_modal') {
    return carteira.resolverSaque(interaction, Number(a), false, interaction.fields.getTextInputValue('motivo'));
  }
  if (ns === 'match') {
    if (acao === 'ss_modal' || acao === 'quebra_modal') {
      return partida.chamarSuporte(interaction, Number(a));
    }
    if (acao === 'rules_modal') return partida.proporRegras(interaction, Number(a));
    if (acao === 'rules_change_modal') return partida.proporRegras(interaction, Number(a), { mudanca: true });
    if (acao === 'rematch_modal') return partida.proporRevanche(interaction, Number(a));
  }
  if (ns === 'streamer') {
    if (interaction.user.id !== a) {
      return nao(interaction, 'Não é seu painel', 'Só o próprio streamer pode usar esse formulário.');
    }
    if (acao === 'aovivo_modal') return streamers.processarAoVivo(interaction, a);
    if (acao === 'abrirfila_modal') return streamers.processarAbrirFila(interaction, a);
  }
}

/* ------------------------------------------------------------- DISPATCHER */

module.exports = async function handleInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = interaction.client.commands.get(interaction.commandName);
      if (!cmd) return;
      return await cmd.execute(interaction);
    }
    if (interaction.isAutocomplete()) {
      const cmd = interaction.client.commands.get(interaction.commandName);
      return cmd?.autocomplete ? await cmd.autocomplete(interaction) : undefined;
    }
    if (interaction.isStringSelectMenu()) return await onSelect(interaction);
    if (interaction.isButton()) return await onButton(interaction);
    if (interaction.isModalSubmit()) return await onModal(interaction);
  } catch (err) {
    console.error('[interaction]', interaction.customId || interaction.commandName, err);
    const msg = ui.msg(ui.bloco(cfg.COR.erro,
      ui.titulo('❌ DEU RUIM'),
      ui.txt('Aconteceu um erro ao processar essa ação. Nenhum valor foi movido indevidamente — se tiver dúvida, chame a staff.'),
    ), { efemero: true });
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(msg);
      else await interaction.reply(msg);
    } catch { /* interacao ja expirou */ }
  }
};
