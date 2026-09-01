const fs = require('node:fs');
const path = require('node:path');

const DIRETORIO = path.join(__dirname, '..', '..', 'assets', 'banners');

// A modalidade usa "x" no bot, enquanto as artes recebidas usam "v".
// Os nomes dos anexos ficam sem espaços/acentos para evitar problemas no Discord.
const ARQUIVOS = Object.freeze({
  '1x1 mobile': '1v1-mobile.png',
  '1x1 misto': '1v1-misto.png',
  '1x1 emulador': '1v1-emulador.png',
  '1x1 tatico': '1v1-tatico.png',
  '2x2 mobile': '2v2-mobile.png',
  '2x2 misto': '2v2-misto.png',
  '2x2 emulador': '2v2-emulador.png',
  '2x2 tatico': '2v2-tatico.png',
  '3x3 mobile': '3v3-mobile.png',
  '3x3 misto': '3v3-misto.png',
  '3x3 emulador': '3v3-emulador.png',
  '3x3 tatico': '3v3-tatico.png',
  '4x4 mobile': '4v4-mobile.png',
  '4x4 misto': '4v4-misto.png',
  '4x4 emulador': '4v4-emulador.png',
  '4x4 tatico': '4v4-tatico.png',
});

function normalizar(modalidade) {
  return String(modalidade || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/(\d)\s*v\s*(\d)/g, '$1x$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Retorna o arquivo e a URL attachment:// da arte da modalidade. */
function obter(modalidade) {
  const nome = ARQUIVOS[normalizar(modalidade)];
  if (!nome) return null;

  const caminho = path.join(DIRETORIO, nome);
  if (!fs.existsSync(caminho)) return null;

  return {
    nome,
    caminho,
    url: `attachment://${nome}`,
  };
}

/* -------------------------------------------------------- BANNERS DE LOG */

// Nome do arquivo esperado para cada tipo de log. Fica na mesma pasta dos
// banners de modalidade (assets/banners/) — solte o PNG la com esse nome.
const ARQUIVOS_LOG = Object.freeze({
  deposito: 'deposito.png',
  voucher: 'voucher.png',
  saque: 'saque.png',
  partida: 'partida.png',
  admin: 'admin.png',
});

/** Igual a obter(), mas para os banners largos dos logs (entrada/saida/partida/admin). */
function obterLog(tipo) {
  const nome = ARQUIVOS_LOG[tipo];
  if (!nome) return null;

  const caminho = path.join(DIRETORIO, nome);
  if (!fs.existsSync(caminho)) return null;

  return {
    nome,
    caminho,
    url: `attachment://${nome}`,
  };
}

/* ------------------------------------------------- BANNERS DE STATUS (TICKET) */

// Banners que entram no topo dos embeds de status dentro do ticket da partida.
const ARQUIVOS_STATUS = Object.freeze({
  finalizada: 'partida-finalizada.png',
  iniciada: 'partida-iniciada.png',
  regras: 'regras-status.png',
  sos: 'sos.png',
});

/** Igual a obter(), mas para os banners de status do ticket (finalizada/iniciada/regras/sos). */
function obterStatus(tipo) {
  const nome = ARQUIVOS_STATUS[tipo];
  if (!nome) return null;

  const caminho = path.join(DIRETORIO, nome);
  if (!fs.existsSync(caminho)) return null;

  return {
    nome,
    caminho,
    url: `attachment://${nome}`,
  };
}

module.exports = { ARQUIVOS, DIRETORIO, normalizar, obter, ARQUIVOS_LOG, obterLog, ARQUIVOS_STATUS, obterStatus };
