const { createCanvas } = require('@napi-rs/canvas');
const { nome: fonte } = require('./fontes');

const VERMELHO = '#FF0101';
const CINZA_PERDEDOR = '#2b2d31';
const FUNDO = '#0a0a0a';

const COLUNAS = ['K', 'D', 'PEITO', 'HS', 'DMG'];
const COL_LARGURA = 90;
const GAP_CENTRO = 190;

/**
 * Card "RESULTADO DA PARTIDA" com a identidade visual da ACE — mesma
 * informação que a ferramenta externa manda (placar + K/D/Peito/HS/DMG por
 * jogador, até 4 por lado), redesenhada com as cores da marca.
 *
 * `vencedores`/`perdedores`: [{ nome, k, d, peito, hs, dmg, mvp }], até 4 itens.
 * `placarVencedor`/`placarPerdedor`: número de rounds/kills do placar do topo.
 */
async function gerar({ vencedores = [], perdedores = [], placarVencedor = 0, placarPerdedor = 0 }) {
  const w = 2000;
  const linhas = Math.max(vencedores.length, perdedores.length, 1);
  const alturaLinha = 90;
  const h = 340 + linhas * alturaLinha + 60;

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = FUNDO;
  ctx.fillRect(0, 0, w, h);

  // Titulo
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 64px "${fonte}"`;
  ctx.fillText('RESULTADO DA PARTIDA', w / 2, 90);

  ctx.strokeStyle = VERMELHO;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 160, 115);
  ctx.lineTo(w / 2 + 160, 115);
  ctx.stroke();

  // Barra de placar: vencedores (vermelho) x perdedores (cinza)
  const meio = w / 2;
  const areaEsqFim = meio - GAP_CENTRO / 2;
  const areaDirInicio = meio + GAP_CENTRO / 2;
  const barraY = 150;
  const barraAltura = 90;

  ctx.fillStyle = VERMELHO;
  ctx.fillRect(40, barraY, areaEsqFim - 40, barraAltura);
  ctx.fillStyle = CINZA_PERDEDOR;
  ctx.fillRect(areaDirInicio, barraY, w - 40 - areaDirInicio, barraAltura);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 40px "${fonte}"`;
  ctx.fillText('VENCEDORES', 75, barraY + 58);
  ctx.textAlign = 'right';
  ctx.fillText(String(placarVencedor), areaEsqFim - 25, barraY + 58);

  ctx.textAlign = 'left';
  ctx.fillText(String(placarPerdedor), areaDirInicio + 25, barraY + 58);
  ctx.textAlign = 'right';
  ctx.fillText('PERDEDORES', w - 75, barraY + 58);

  // Circulo central (emblema ACE)
  const raioCirculo = GAP_CENTRO / 2 - 8;
  ctx.beginPath();
  ctx.arc(meio, barraY + barraAltura / 2, raioCirculo, 0, Math.PI * 2);
  ctx.fillStyle = '#000000';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = VERMELHO;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = VERMELHO;
  ctx.font = `bold 32px "${fonte}"`;
  ctx.fillText('ACE', meio, barraY + barraAltura / 2 + 11);

  // Colunas de cada lado: 5 colunas (K/D/PEITO/HS/DMG) terminando na borda do
  // circulo central, nome do jogador ocupa o espaço da borda ate o inicio delas.
  const colunasLarguraTotal = COLUNAS.length * COL_LARGURA;
  const colInicioEsq = areaEsqFim - 45 - colunasLarguraTotal + COL_LARGURA / 2;
  const colInicioDir = areaDirInicio + 45 + colunasLarguraTotal - COL_LARGURA / 2;

  const colY = barraY + barraAltura + 60;

  ctx.font = `bold 24px "${fonte}"`;
  ctx.fillStyle = '#8a8a8a';
  ctx.textAlign = 'left';
  ctx.fillText('APELIDO', 75, colY);
  ctx.textAlign = 'right';
  ctx.fillText('APELIDO', w - 75, colY);

  COLUNAS.forEach((c, i) => {
    ctx.textAlign = 'center';
    ctx.fillText(c, colInicioEsq + i * COL_LARGURA, colY);
    ctx.fillText(c, colInicioDir - i * COL_LARGURA, colY);
  });

  // Linhas dos jogadores
  const linhaInicioY = colY + 55;
  const nomeMaxLargura = colInicioEsq - COL_LARGURA / 2 - 30 - 75; // espaco disponivel pro nome

  const desenharLado = (lista, corDestaque, esquerda, colInicio) => {
    lista.slice(0, 4).forEach((p, i) => {
      const y = linhaInicioY + i * alturaLinha;

      ctx.fillStyle = corDestaque;
      ctx.fillRect(esquerda ? 40 : w - 46, y - 32, 6, 48);

      ctx.textAlign = esquerda ? 'left' : 'right';
      ctx.fillStyle = '#ffffff';
      let tamanhoFonte = 30;
      ctx.font = `bold ${tamanhoFonte}px "${fonte}"`;
      const rotulo = `${p.mvp ? 'MVP ' : ''}${String(p.nome || '—').toUpperCase()}`;
      while (ctx.measureText(rotulo).width > nomeMaxLargura && tamanhoFonte > 16) {
        tamanhoFonte -= 2;
        ctx.font = `bold ${tamanhoFonte}px "${fonte}"`;
      }
      const xNome = esquerda ? 75 : w - 75;
      if (p.mvp) {
        ctx.save();
        ctx.fillStyle = corDestaque;
        ctx.font = `bold ${Math.round(tamanhoFonte * 0.62)}px "${fonte}"`;
        ctx.fillText('MVP', xNome, y - tamanhoFonte * 0.62);
        ctx.restore();
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${tamanhoFonte}px "${fonte}"`;
        ctx.fillText(String(p.nome || '—').toUpperCase(), xNome, y + 6);
      } else {
        ctx.fillText(String(p.nome || '—').toUpperCase(), xNome, y);
      }

      const valores = [p.k, p.d, p.peito, p.hs, p.dmg].map((v) => (v == null ? '-' : String(v)));
      ctx.font = `bold 26px "${fonte}"`;
      valores.forEach((v, idx) => {
        ctx.textAlign = 'center';
        const x = esquerda ? colInicio + idx * COL_LARGURA : colInicio - idx * COL_LARGURA;
        ctx.fillStyle = idx === valores.length - 1 ? corDestaque : '#e0e0e0';
        ctx.fillText(v, x, y);
      });
    });
  };

  desenharLado(vencedores, VERMELHO, true, colInicioEsq);
  desenharLado(perdedores, '#b0b0b0', false, colInicioDir);

  return canvas.encode('png');
}

module.exports = { gerar };
