const partida = require('../features/partida');
const salaBot = require('../bots/salaBot');
const resultadoOcr = require('../lib/resultadoOcr');
const resultadoBanner = require('../lib/resultadoBanner');

/**
 * Espelha TODA mensagem que a conta do self-bot (ver src/bots/salaBot.js)
 * manda/edita no ticket sobre a criação da sala — desde o "fielsete" já é a
 * mesma conta que recebe os comandos # / * / % / TÁTICO, tudo que ela posta
 * ali é sobre esse processo.
 *
 * Mensagens que a ferramenta externa fica EDITANDO no mesmo lugar (lista de
 * times enquanto os jogadores entram, placar a cada round) são só espelhadas
 * — o original continua existindo pra ela seguir editando. Mensagens de
 * evento único (GO confirmado, ambos confirmaram/partida iniciada, foto
 * final do resultado) são apagadas depois de processadas.
 */

/** Remove as marcações de diff (``` +/-) e de blockquote (>) do conteúdo. */
function limpar(conteudo) {
  return (conteudo || '')
    .replace(/```diff/gi, '')
    .replace(/```/g, '')
    .replace(/^[+-]\s?/gm, '')
    .replace(/^>\s?/gm, '')
    .trim();
}

/** TIME 1/TIME 2 com até 4 slots cada — "Aguardando jogador..." ou "nome — id". */
function parseInformacoesSala(texto) {
  const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
  const times = { 1: [], 2: [] };
  let atual = null;
  let statusLabel = null;

  for (const linha of linhas) {
    if (/^TIME\s*1\b/i.test(linha)) { atual = 1; continue; }
    if (/^TIME\s*2\b/i.test(linha)) { atual = 2; continue; }

    const slotMatch = /^(\d{2})\s+(.+)$/.exec(linha);
    if (atual && slotMatch) {
      // Tira o emoji de dispositivo (🕹️/🖥️) do começo da linha, sobra "nome — id".
      const resto = slotMatch[2].replace(/^[^\p{L}\p{N}]+/u, '').trim();
      if (/aguardando jogador/i.test(resto)) {
        times[atual].push({ slot: slotMatch[1], vazio: true });
      } else {
        const pm = /^(.+?)\s*[—-]\s*(\S+)$/.exec(resto);
        times[atual].push(pm
          ? { slot: slotMatch[1], nome: pm[1].trim(), ffid: pm[2].trim() }
          : { slot: slotMatch[1], nome: resto });
      }
      continue;
    }

    if (/AGUARDANDO JOGADORES/i.test(linha)) statusLabel = 'AGUARDANDO';
    else if (/SALA (PRONTA|CHEIA)/i.test(linha)) statusLabel = 'PRONTA';
  }

  return { times, statusLabel };
}

async function processar(message) {
  try {
    if (!message.guildId) return;

    const selfBotId = salaBot.getUserId();
    if (!selfBotId || message.author?.id !== selfBotId) return;

    const m = partida.getByThread(message.channel.id);
    if (!m) return;

    const client = message.client;
    const texto = limpar(message.content);
    const anexoImagem = message.attachments?.find((a) => (a.contentType || '').startsWith('image/'));

    // 1) Cartão de informações da sala — editável, NÃO apaga o original.
    if (/INFORMA[ÇC][ÕO]ES DA SALA|^TIME\s*1\b/im.test(texto)) {
      if (m.status === 'AGUARDANDO_SALA') await partida.marcarSalaCriada(client, m.id);
      await partida.atualizarStatusSala(client, m.id, parseInformacoesSala(texto));
      return;
    }

    // 2) Placar ao vivo — editável a cada round, NÃO apaga o original.
    const placarMatch = /A PARTIDA EST[ÁA]\s+(\d+)\s*[xX]\s*(\d+)/.exec(texto);
    if (placarMatch) {
      await partida.atualizarPlacarSala(client, m.id, placarMatch[1], placarMatch[2]);
      return;
    }

    // 3) GO confirmado — evento único: descobre quem confirmou pela mensagem
    // respondida (a ferramenta responde direto ao "g"/"go" do jogador).
    if (/GO CONFIRMADO/i.test(texto)) {
      const ref = message.reference
        ? await message.channel.messages.fetch(message.reference.messageId).catch(() => null)
        : null;
      if (ref?.author?.id) await partida.registrarGo(client, m.id, ref.author.id);
      await message.delete().catch(() => {});
      return;
    }

    // 4) Ambos confirmaram / partida iniciada — evento único; garante a
    // transição (idempotente — se já estiver EM_ANDAMENTO não faz nada).
    if (/AMBOS OS JOGADORES CONFIRMARAM|PARTIDA INICIADA/i.test(texto)) {
      await partida.iniciarPartidaAutomatico(client, m.id);
      await message.delete().catch(() => {});
      return;
    }

    // 5) Foto final do resultado — evento único: OCR extrai os dados e a
    // gente posta o mesmo resultado com a identidade visual da ACE. Isso
    // NUNCA decide o vencedor sozinho — só alimenta o banner; quem venceu
    // continua sendo escolhido no seletor manual (liberarResultado).
    if (anexoImagem && m.status === 'EM_ANDAMENTO') {
      let dados = null;
      try {
        const resp = await fetch(anexoImagem.url);
        const buffer = Buffer.from(await resp.arrayBuffer());
        dados = await resultadoOcr.extrair(buffer);
      } catch (e) {
        console.error(`[partida #${m.id}] falha no OCR do resultado:`, e.message);
      }

      if (dados && (dados.vencedores.length || dados.perdedores.length)) {
        try {
          const banner = await resultadoBanner.gerar(dados);
          const thread = await client.channels.fetch(m.thread_id);
          await thread.send({ files: [{ attachment: banner, name: `resultado-${m.id}.png` }] });
        } catch (e) {
          console.error(`[partida #${m.id}] falha ao gerar banner de resultado:`, e.message);
        }
      }

      await partida.liberarResultado(client, m.id);
      await message.delete().catch(() => {});
    }
  } catch (e) {
    console.error('[sala-bot-mirror]', e.message);
  }
}

module.exports = {
  onMessageCreate: processar,
  onMessageUpdate: (_antiga, nova) => processar(nova),
};
