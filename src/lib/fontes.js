const fs = require('node:fs');
const path = require('node:path');
const { GlobalFonts } = require('@napi-rs/canvas');

/**
 * Registro central da fonte da identidade visual (Druk Wide Bold), usada em
 * todo banner desenhado por canvas (vencedor, resultado da partida...).
 * Registrar duas vezes o mesmo nome de família dá erro — por isso isso mora
 * num módulo só, carregado (e registrado) uma única vez por processo.
 */
const NOME = 'Druk Wide Bold';
const CAMINHOS = [
  'DrukWideBold.otf', 'DrukWideBold.ttf',
  'Druk Wide Bold.otf', 'Druk Wide Bold.ttf',
].map((f) => path.join(__dirname, '..', '..', 'assets', 'fonts', f));

let nome = 'Arial';
for (const caminho of CAMINHOS) {
  if (fs.existsSync(caminho)) {
    try {
      GlobalFonts.registerFromPath(caminho, NOME);
      nome = NOME;
      break;
    } catch { /* arquivo invalido: segue com Arial */ }
  }
}

module.exports = { nome };
