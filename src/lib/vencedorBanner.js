const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const TEMPLATE = path.join(__dirname, '..', '..', 'assets', 'banners', 'vencedor-template.png');

// Fonte da identidade visual (Druk Wide Bold). Solte o arquivo em
// assets/fonts/ com um desses nomes que ele é registrado automaticamente.
// Sem o arquivo, cai pro Arial em negrito — o layout continua funcionando.
const FONTE_NOME = 'Druk Wide Bold';
const CAMINHOS_FONTE = [
  'DrukWideBold.otf', 'DrukWideBold.ttf',
  'Druk Wide Bold.otf', 'Druk Wide Bold.ttf',
].map((f) => path.join(__dirname, '..', '..', 'assets', 'fonts', f));

let fonte = 'Arial';
for (const caminho of CAMINHOS_FONTE) {
  if (fs.existsSync(caminho)) {
    try {
      GlobalFonts.registerFromPath(caminho, FONTE_NOME);
      fonte = FONTE_NOME;
      break;
    } catch { /* arquivo invalido: segue com Arial */ }
  }
}

/**
 * Gera o banner dinâmico do vencedor: template fixo (fundo vermelho ACE) +
 * foto do Discord recortada em círculo + nome/valor/data desenhados por cima,
 * seguindo exatamente o layout-guia (posições em fração do template).
 * Retorna um Buffer PNG pronto pra anexar numa mensagem.
 */
async function gerar({ avatarUrl, nome, valorTexto, dataTexto }) {
  const template = await loadImage(TEMPLATE);
  const w = template.width;
  const h = template.height;

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(template, 0, 0);

  const raio = w * 0.266;
  const cx = w / 2;
  const cy = h * 0.513;

  try {
    const avatar = await loadImage(avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, raio, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, cx - raio, cy - raio, raio * 2, raio * 2);
    ctx.restore();
  } catch {
    // Sem avatar (ex.: falha ao baixar): segue só com o template, sem foto.
  }

  ctx.beginPath();
  ctx.arc(cx, cy, raio, 0, Math.PI * 2);
  ctx.lineWidth = w * 0.012;
  ctx.strokeStyle = '#000000';
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#000000';

  ctx.font = `bold ${Math.round(w * 0.095)}px "${fonte}"`;
  ctx.fillText(String(nome || '').toUpperCase().slice(0, 24), cx, h * 0.777);

  ctx.font = `bold ${Math.round(w * 0.115)}px "${fonte}"`;
  ctx.fillText(String(valorTexto || ''), cx, h * 0.85);

  ctx.font = `bold ${Math.round(w * 0.065)}px "${fonte}"`;
  ctx.fillText(String(dataTexto || ''), cx, h * 0.889);

  return canvas.encode('png');
}

module.exports = { gerar };
