const { test } = require('node:test');
const assert = require('node:assert/strict');
const emojiServidor = require('../src/lib/emojiServidor');
const ui = require('../src/lib/ui');

test('identifica emojis do servidor e troca emojis comuns pelo equivalente personalizado', async () => {
  const itens = new Map([
    ['1542020930262401075', { id: '1542020930262401075', name: 'verifi2', animated: false }],
    ['1542020930262401076', { id: '1542020930262401076', name: 'SOS', animated: true }],
  ]);
  await emojiServidor.carregar({ emojis: { fetch: async () => itens, cache: itens } });
  const texto = emojiServidor.personalizar('✅ Confirmado 🆘 Ajuda ❌ Erro');
  assert.match(texto, /<:verifi2:1542020930262401075>/);
  assert.match(texto, /<a:SOS:1542020930262401076>/);
  assert.match(texto, /<:logored:1542019888095301642>/);
  assert.doesNotMatch(texto, /✅|🆘|❌/u);
});

test('ícone sem equivalente nunca mantém emoji comum', () => {
  const texto = emojiServidor.personalizar('🤖 Sistema');
  assert.match(texto, /^<:[A-Za-z0-9_]+:\d+>/);
  assert.doesNotMatch(texto, /🤖/u);
});

test('botão move emoji comum do rótulo para o ícone personalizado', () => {
  const json = ui.botao('teste', '✅ CONFIRMAR').toJSON();
  assert.equal(json.label, 'CONFIRMAR');
  assert.equal(json.emoji.id, '1542020930262401075');
  assert.doesNotMatch(JSON.stringify(json), /✅/u);
});
