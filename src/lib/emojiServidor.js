const conhecidos = require('./emojis');

const EMOJI_RE = /(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/gu;
const CUSTOM_RE = /^<a?:[A-Za-z0-9_]+:\d+>$/;

const aliases = {
  '❌': ['erro', 'errado', 'nao', 'cancelar', 'recusar', 'x'],
  '✅': ['verifi2', 'verificado', 'certo', 'confirmar', 'aceitar', 'check'],
  '⚠️': ['aviso', 'alerta', 'atencao', 'warning'],
  '🚫': ['bloqueado', 'proibido', 'cancelar', 'ban'],
  '🟢': ['online', 'ativo', 'verde', 'confirmar'], '🔴': ['offline', 'vermelho', 'recusar'],
  '⚪': ['neutro', 'branco', 'inativo'], '⚫': ['offline', 'preto'],
  '⚙️': ['config', 'configuracao', 'engrenagem'], '🛠️': ['gerenciar', 'ferramenta', 'staff'],
  '🗑️': ['lixeira', 'apagar', 'deletar'], '🧹': ['limpar', 'vassoura'],
  '👤': ['user', 'usuario', 'perfil'], '👥': ['duas', 'grupo', 'jogadores', 'users'],
  '🙋': ['user', 'usuario', 'jogador'], '👮': ['staff', 'admin', 'moderador'],
  '💰': ['cifrao', 'dinheiro', 'saldo'], '💵': ['cifrao', 'dinheiro', 'saldo'],
  '💳': ['depositar', 'pix', 'cartao', 'pagamento'], '🏦': ['sacar', 'banco', 'saque'],
  '📥': ['depositar', 'entrada', 'download'], '📤': ['sacar', 'saida', 'upload'],
  '🪙': ['moeda', 'coin', 'pontos'], '🎟️': ['ticket', 'voucher', 'cupom'],
  '🎮': ['pt', 'partida', 'jogo', 'game'], '🕹️': ['pt', 'partida', 'jogo'],
  '⚔️': ['pt', 'partida', 'batalha'], '🏆': ['trofeu', 'campeao', 'vencedor'],
  '🥇': ['ouro', 'primeiro', 'medalha'], '🥈': ['prata', 'segundo', 'medalha'],
  '🥉': ['bronze', 'terceiro', 'medalha'], '🎖️': ['medalha', 'ranking', 'elo'],
  '⭐': ['estrela', 'star', 'mvp'], '✨': ['estrela', 'brilho'],
  '🔥': ['fogo', 'fire', 'streak'], '❄️': ['glo', 'gelo', 'ice'],
  '♾️': ['infinito', 'infinity'], '🔫': ['um1', 'arma', 'ump', 'xm8'],
  '📱': ['cel', 'mobile', 'celular'], '🖥️': ['pc', 'emu', 'emulador', 'computador'],
  '💻': ['pc', 'emu', 'emulador'], '❔': ['duvida', 'interrogacao', 'ajuda'],
  'ℹ️': ['info', 'informacao'], '🆘': ['sos', 'suporte', 'ajuda'],
  '📄': ['arquivo', 'documento', 'regras'], '📋': ['lista', 'clipboard', 'regras'],
  '📜': ['regras', 'documento'], '📎': ['anexo', 'arquivo'],
  '📊': ['grafico', 'ranking', 'status'], '📈': ['subir', 'alta', 'ranking'],
  '📉': ['descer', 'baixa'], '📦': ['caixa', 'pedido', 'box'],
  '🎁': ['caixa', 'presente', 'premio'], '🎲': ['dado', 'sorteio', 'roleta'],
  '🛒': ['loja', 'carrinho'], '💡': ['ideia', 'lampada', 'sugestao'],
  '💬': ['chat', 'mensagem'], '🗳️': ['voto', 'votacao'],
  '📅': ['evento', 'calendario', 'data'], '🗓️': ['evento', 'calendario'], '📆': ['evento', 'calendario'],
  '🎥': ['streamer', 'video', 'camera', 'var'], '📺': ['streamer', 'tv', 'live'],
  '⏱️': ['relogio', 'tempo', 'timer'], '⏰': ['relogio', 'tempo'], '⏳': ['relogio', 'aguardando'], '⌛': ['relogio', 'aguardando'],
  '🔄': ['atualizar', 'refresh', 'recarregar'], '🔁': ['revanche', 'repetir', 'refresh'],
  '↩️': ['voltar', 'estorno', 'cancelar'], '🔗': ['link', 'ligar'], '🌐': ['link', 'site', 'web'],
  '🔒': ['cadeado', 'lock', 'bloqueado'], '🔓': ['desbloquear', 'unlock'],
  '🤝': ['completar', 'acordo', 'parceria'], '🎉': ['festa', 'parabens', 'premio'],
  '🚀': ['iniciar', 'ligar', 'start'], '🏁': ['finalizada', 'fim', 'resultado'],
  '🚩': ['denuncia', 'regra', 'flag'], '⚖️': ['veredito', 'justica', 'revisao'],
  '🤖': ['bot', 'ia', 'robo'], '📚': ['regras', 'livro'], '⏸️': ['pausa', 'desativar'],
  '🪜': ['ranking', 'elo', 'escada'], '💔': ['derrota', 'perdeu'],
  '🔔': ['notificacao', 'sino'], '1️⃣': ['um', '1'], '2️⃣': ['dois', '2'],
};

let inventario = [];

const normalizar = (valor) => String(valor || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

function mencao(emoji) {
  if (!emoji) return '';
  if (typeof emoji === 'string') return CUSTOM_RE.test(emoji) ? emoji : '';
  return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
}

function escolher(candidatos) {
  const termos = candidatos.map(normalizar).filter(Boolean);
  for (const termo of termos) {
    const exato = inventario.find((e) => normalizar(e.name) === termo);
    if (exato) return mencao(exato);
  }
  for (const termo of termos) {
    const parcial = inventario.find((e) => normalizar(e.name).includes(termo) || termo.includes(normalizar(e.name)));
    if (parcial) return mencao(parcial);
  }
  return '';
}

function resolver(simbolo) {
  if (!simbolo) return '';
  if (CUSTOM_RE.test(String(simbolo))) return String(simbolo);
  const candidatos = aliases[simbolo] || [];
  const achado = escolher(candidatos);
  if (achado) return achado;
  const fallback = {
    '📱': conhecidos.mobile, '🖥️': conhecidos.emulador, '💻': conhecidos.emulador,
    '💰': conhecidos.cifrao, '💵': conhecidos.cifrao, '👤': conhecidos.user,
    '👥': conhecidos.duas, '📥': conhecidos.depositar, '📤': conhecidos.sacar,
    '🎟️': conhecidos.ticket, '🎮': conhecidos.partida, '🕹️': conhecidos.partida,
    '⚔️': conhecidos.partida, '❄️': conhecidos.gelo, '♾️': conhecidos.infinito,
    '🔫': conhecidos.fullArma, '🔗': conhecidos.entrar,
  }[simbolo];
  return mencao(fallback) || conhecidos.logo;
}

function personalizar(texto) {
  return String(texto ?? '').replace(EMOJI_RE, (simbolo) => resolver(simbolo));
}

function limparComuns(texto) {
  return String(texto ?? '').replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim();
}

async function carregar(guild) {
  if (!guild) return [];
  let emojis;
  try { emojis = await guild.emojis.fetch(); }
  catch { emojis = guild.emojis.cache; }
  inventario = [...emojis.values()].map((e) => ({ id: e.id, name: e.name, animated: e.animated }));
  console.log(`[emojis] ${inventario.length} emoji(s) personalizado(s) identificados: ${inventario.map((e) => e.name).join(', ')}`);
  return inventario;
}

const listar = () => inventario.map((e) => ({ ...e }));

module.exports = { carregar, listar, personalizar, limparComuns, resolver, EMOJI_RE };
