const gc = require('./guildconfig');
const ui = require('./ui');
const { COR } = require('../config');
const money = require('./money');
const banners = require('./banners');
const fila = require('../features/fila');
const emo = require('./emojis');

// Emojis reaproveitados do registro central (lib/emojis.js) pra o log ter a
// mesma cara dos paineis. Nunca colocar esses emojis dentro de ui.tabela():
// o bloco de codigo que ela usa impede o Discord de renderizar emoji
// customizado, ele aparece como texto cru.
const E = {
  deposito: emo.depositar,
  saque: emo.sacar,
  voucher: emo.ticket,
  cifrao: emo.cifrao,
  logo: emo.logo,
  user: emo.user,
};

/** Anexa o banner do tipo de log (se o arquivo existir) e manda a mensagem. */
async function send(client, guildId, key, tipo, container) {
  const ch = await gc.channel(client, guildId, key);
  if (!ch) return;

  const banner = banners.obterLog(tipo);
  const msg = ui.msg(container, banner ? { files: [{ attachment: banner.caminho, name: banner.nome }] } : {});

  try {
    await ch.send(msg);
  } catch (e) {
    console.error(`[log] falha ao enviar em ${key}:`, e.message);
  }
}

const quando = () => `<t:${Math.floor(Date.now() / 1000)}:f>`;

/** Cabecalho padrao: banner (se existir) + emoji do tipo + titulo + linha do jogador. */
const cabecalho = (tipo, titulo, jogadorTxt) => [
  banners.obterLog(tipo) ? ui.imagem(banners.obterLog(tipo).url) : null,
  ui.titulo(`${E[tipo] || ''} ${titulo}`.trim()),
  ui.nota(jogadorTxt),
];

module.exports = {
  async deposito(client, guildId, { userId, amount, saldo, metodo, ref }) {
    await send(client, guildId, 'canal_log_deposito', 'deposito', ui.bloco(COR.sucesso,
      ...cabecalho('deposito', 'ENTRADA · Depósito aprovado', `<@${userId}> · \`${userId}\``),
      ui.divisor(),
      ui.txt(
        `${E.cifrao} **Valor creditado:** ${money.fmt(amount)}\n` +
        `${E.cifrao} **Saldo do jogador:** ${money.fmt(saldo)}\n` +
        `**Metodo:** ${metodo || 'PIX'}`
      ),
      ui.nota(`${quando()}${ref ? ` · ref \`${ref}\`` : ''}`),
    ));
  },

  async voucher(client, guildId, { userId, code, amount, saldo, usos, max, criadoPor }) {
    await send(client, guildId, 'canal_log_deposito', 'voucher', ui.bloco(COR.sucesso,
      ...cabecalho('voucher', 'ENTRADA · Voucher resgatado', `<@${userId}> · \`${userId}\``),
      ui.txt(`Código \`${code}\` · criado por <@${criadoPor}>`),
      ui.divisor(),
      ui.txt(
        `${E.cifrao} **Valor creditado:** ${money.fmt(amount)}\n` +
        `${E.cifrao} **Saldo do jogador:** ${money.fmt(saldo)}\n` +
        `**Usos do voucher:** ${usos}/${max}`
      ),
      ui.nota(quando()),
    ));
  },

  async saque(client, guildId, { userId, amount, status, staffId, pixKey, motivo, id }) {
    const pago = status === 'PAGO';
    await send(client, guildId, 'canal_log_saque', 'saque', ui.bloco(pago ? COR.erro : COR.aviso,
      ...cabecalho('saque', `SAÍDA · Saque ${pago ? 'pago' : 'recusado'}`, `<@${userId}> · \`${userId}\``),
      ui.txt(`${E.user} Resolvido por ${staffId ? `<@${staffId}>` : '—'}`),
      ui.divisor(),
      ui.txt(
        `${E.cifrao} **Valor:** ${money.fmt(amount)}\n` +
        `**Chave PIX:** \`${pixKey}\``
      ),
      motivo ? ui.txt(`**Motivo:** ${motivo}`) : null,
      ui.nota(`Saque #${id} · ${quando()}`),
    ));
  },

  /**
   * Log PUBLICO de saque — visivel para o servidor inteiro.
   * So o banner, o emoji, quem sacou, o valor e uma frase curta.
   * Sem chave PIX, sem staff, sem ID: isso e informacao interna, fica so no log privado.
   */
  async saquePublico(client, guildId, { userId, amount }) {
    await send(client, guildId, 'canal_saque_publico', 'saque', ui.bloco(COR.primaria,
      banners.obterLog('saque') ? ui.imagem(banners.obterLog('saque').url) : null,
      ui.titulo(`${E.saque} SAQUE REALIZADO`),
      ui.divisor(),
      ui.txt(`<@${userId}> acabou de sacar **${money.fmt(amount)}**! ${emo.cifrao}`),
      ui.nota(quando()),
    ));
  },

  async partida(client, guildId, m, { winnerId, motivo }) {
    const perdedor = winnerId === m.p1 ? m.p2 : m.p1;
    await send(client, guildId, 'canal_log_partidas', 'partida', ui.bloco(COR.primaria,
      ...cabecalho('partida', 'PARTIDA FINALIZADA', `🥇 <@${winnerId}>  venceu  💀 <@${perdedor}>`),
      ui.divisor(),
      ui.txt(
        `**Modalidade:** ${m.modalidade}\n` +
        `**Modo:** ${fila.rotuloModo(m.gelo)}\n` +
        `${E.cifrao} **Valor por jogador:** ${money.fmt(m.valor)}\n` +
        `${E.cifrao} **Premio pago:** ${money.fmt(m.valor * 2 - m.taxa)}\n` +
        `${E.cifrao} **Taxa da organizacao:** ${money.fmt(m.taxa)}`
      ),
      motivo ? ui.txt(`**Resolução:** ${motivo}`) : null,
      ui.nota(`Partida #${m.id} · ${quando()}`),
    ));
  },

  async admin(client, guildId, { staffId, userId, amount, acao, motivo }) {
    const key = amount >= 0 ? 'canal_log_deposito' : 'canal_log_saque';
    await send(client, guildId, key, 'admin', ui.bloco(COR.aviso,
      ...cabecalho('admin', acao, `Alvo: <@${userId}> · Staff: <@${staffId}>`),
      ui.divisor(),
      ui.txt(`${E.cifrao} **${amount >= 0 ? 'Valor adicionado' : 'Valor removido'}:** ${money.fmt(Math.abs(amount))}`),
      motivo ? ui.txt(`**Motivo:** ${motivo}`) : null,
      ui.nota(quando()),
    ));
  },
};
