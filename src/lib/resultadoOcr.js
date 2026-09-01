const { createWorker } = require('tesseract.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

/**
 * Extrai os dados estruturados do card "RESULTADO DA PARTIDA" que a
 * ferramenta externa manda como imagem (placar + K/D/Peito/HS/DMG de até
 * 4 jogadores por lado), via OCR. Best-effort: campo que o OCR não
 * reconheceu direito vira null em vez de travar o processo inteiro.
 *
 * NUNCA decide o vencedor sozinho — só alimenta o banner de identidade
 * visual (resultadoBanner.js). A escolha de quem venceu continua manual,
 * no seletor que já existe no ticket.
 */
async function extrair(buffer) {
  const img = await loadImage(buffer);
  const w = img.width;
  const h = img.height;

  // Recorta a metade esquerda (vencedores) e direita (perdedores), cada
  // metade com um pouco de sobreposição no centro pra nao cortar texto.
  const metadeEsq = await recortar(img, 0, 0, Math.round(w * 0.52), h);
  const metadeDir = await recortar(img, Math.round(w * 0.48), 0, Math.round(w * 0.52), h);

  const worker = await createWorker('por');
  try {
    const [tEsq, tDir] = await Promise.all([
      worker.recognize(metadeEsq).then((r) => r.data.text),
      worker.recognize(metadeDir).then((r) => r.data.text),
    ]);

    return {
      placarVencedor: extrairPlacar(tEsq),
      placarPerdedor: extrairPlacar(tDir),
      vencedores: extrairJogadores(tEsq),
      perdedores: extrairJogadores(tDir),
    };
  } finally {
    await worker.terminate();
  }
}

async function recortar(img, x, y, larg, alt) {
  const canvas = createCanvas(larg, alt);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, -x, -y);
  return canvas.encode('png');
}

/** Primeiro número "solto" (não colado a outra palavra) perto de VENCEDORES/PERDEDORES. */
function extrairPlacar(texto) {
  const m = /(?:VENCEDOR|PERDEDOR)\w*\D{0,6}(\d{1,3})|(\d{1,3})\D{0,6}(?:VENCEDOR|PERDEDOR)/i.exec(texto);
  if (!m) return null;
  const n = Number(m[1] ?? m[2]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Linhas de jogador têm o formato "APELIDO K D PEITO HS DMG" (5 números no
 * final). Ignora linhas de cabeçalho/título. MVP não é confiável via OCR
 * (a coroa vira lixo) — fica sempre false, o usuário ajusta manualmente se
 * quiser destacar alguém no banner.
 */
function extrairJogadores(texto) {
  const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
  const jogadores = [];

  for (const linha of linhas) {
    if (/RESULTADO|VENCEDOR|PERDEDOR|APELIDO|^K\s|GEA|SALAS/i.test(linha)) continue;

    const numeros = linha.match(/-?\d+/g);
    if (!numeros || numeros.length < 5) continue;

    const ultimos5 = numeros.slice(-5).map(Number);
    const nome = linha.replace(/-?\d+/g, '').replace(/[^\wÀ-ÿ_\s]/g, '').trim();
    if (!nome) continue;

    const [k, d, peito, hs, dmg] = ultimos5;
    jogadores.push({ nome, k, d, peito, hs, dmg, mvp: false });
  }

  return jogadores.slice(0, 4);
}

module.exports = { extrair, extrairPlacar, extrairJogadores };
