const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.NIX_API_KEY = 'test-key';
const databasePath = require.resolve('../src/db/database');
const writes = [];
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true,
  exports: { prepare: sql => ({ run: (...args) => {
    writes.push(sql);
    if (sql.includes('nix_poll_at = ?')) m.nix_poll_at = args[0];
    if (sql.includes('nix_result_msg_id = ?')) m.nix_result_msg_id = args[0];
    if (sql.includes('nix_poll_done = 1')) m.nix_poll_done = 1;
  } }) } };
const api = require('../src/lib/nixSalas');
const cfg = require('../src/config');
const ui = require('../src/features/nixPainel');
const m = { id: 1, modalidade: '4v4 Mobile', gelo: 'NORMAL', status: 'SALA_CRIADA',
  thread_id: 'ticket', nix_session_id: 'session', nix_room_id: '123', nix_room_password: '67',
  sala_pronta_em: Date.now(), nix_poll_at: 0, nix_poll_done: 0 };
const player = { nickname: 'Jogador', player_uid: '1234', team: 2, slot: 5, platform: 'mobile' };
test('senha de dois dígitos e templates sem mapa', () => {
  for (let i=0;i<100;i++) assert.match(api.configuracaoDaSala(m).password, /^[1-9][0-9]$/);
  assert.equal(api.configuracaoDaSala(m).config_type, 'ap_padrao');
  assert.equal(api.configuracaoDaSala({...m, gelo:'INFINITO'}).config_type, 'gelo_inf');
  assert.equal(api.configuracaoDaSala({...m, modalidade:'4v4 Tático'}).config_type, 'tatico');
  assert.equal('map_name' in api.configuracaoDaSala(m), false);
});
test('painel serializa slots, dispositivos e controles como embed clássico', () => {
  const payload = ui.painel(m, [player, {...player, player_uid:'567', slot:1, platform:'emulator'}]);
  const json = JSON.stringify(payload);
  assert.match(json, /#1/); assert.match(json, /#5/);
  assert.ok(json.indexOf('#1') < json.indexOf('#5'));
  assert.match(json, /📱/); assert.match(json, /🖥️/);
  assert.match(json, /Time 1/); assert.match(json, /Time 2/);
  assert.doesNotMatch(json, /Expulsar/);
  assert.match(json, /Copiar ID e Senha/);
  assert.equal(payload.flags, undefined);
  assert.equal(payload.embeds[0].toJSON().color, 0xff0101);
});
test('rotas autenticadas, uid em string e tratamento de 429', async () => {
  const old = global.fetch;
  const calls=[];
  global.fetch=async(url, opts) => {
    calls.push({url,opts});
    return new Response(JSON.stringify({members:[]}), {status:200});
  };
  try {
    await api.membros('a/b'); await api.expulsar('a/b', '123');
    assert.ok(calls[0].url.endsWith('/rooms/a%2Fb/members'));
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer test-key');
    assert.deepEqual(JSON.parse(calls[1].opts.body), {player_uid:'123'});
    global.fetch=async()=>new Response('{}',{status:429,headers:{'Retry-After':'40'}});
    await assert.rejects(api.resultado('a'), e=>e.status===429 && e.retryAfter==='40');
  } finally { global.fetch=old; }
});
test('resultado mantém dados reais e não inventa placar', () => {
  const json=JSON.stringify(ui.resultadoEmbed(m,{status:'finalizada',session_id:'session',room_id:'123',
    started_at:'2026-09-09T20:00:00Z',finished_at:'2026-09-09T20:10:00Z',winner_team:2,
    teams:[{team:2,is_winner:true,players:[{nickname:'Vencedor',account_id:123,kills:5,
      knockdowns:4,headshots:3,revives:2,won:true,team_inferred:false,platform:'mobile'}]}]}));
  assert.match(json,/Time vencedor: 2/); assert.match(json,/Vencedor/);
  assert.match(json,/Derrubados/); assert.match(json,/Headshots/); assert.match(json,/Revives/);
  assert.match(json,/session/); assert.doesNotMatch(json,/Placar/);
});
test('embed de início mostra times, slot, dispositivo e horário', () => {
  const json=JSON.stringify(ui.inicioEmbed({...m,status:'EM_ANDAMENTO',em_andamento_em:Date.now()},[player],null,true));
  assert.match(json,/Sala iniciada com sucesso/); assert.match(json,/automática/);
  assert.match(json,/Time 1/); assert.match(json,/Time 2/); assert.match(json,/#5/); assert.match(json,/📱/);
  assert.match(json,/<t:/);
  assert.match(json,/Recriar sala/); assert.match(json,/R\$ 0,50/);
  assert.doesNotMatch(json,/CHAMAR SUPORTE/);
});
test('polling final publica uma vez e encerra consultas', async () => {
  m.status='EM_ANDAMENTO'; m.em_andamento_em=Date.now();
  const path=require.resolve('../src/features/partida');
  let released=0;
  require.cache[path]={id:path,filename:path,loaded:true,exports:{
    get:()=>m, liberarResultado:async()=>{released++;},
  }};
  const old=api.resultado;
  let calls=0, messages=0;
  api.resultado=async()=>{calls++;return {status:'finalizada',poll_after_seconds:null,teams:[],winner_team:1};};
  const client={user:{displayAvatarURL:()=>null},channels:{fetch:async()=>({
    send:async()=>({id:String(++messages)}),messages:{edit:async()=>({})},
  })}};
  try {
    await ui.atualizar(client,1); await ui.atualizar(client,1);
    assert.equal(calls,1); assert.equal(released,1); assert.equal(m.nix_poll_done,1);
    assert.ok(m.nix_result_msg_id);
  } finally { api.resultado=old; }
});

test('não edita painel idêntico; altera quando jogador troca dispositivo', async () => {
  m.nix_panel_id = 'panel';
  let edits = 0;
  const client = { user: { displayAvatarURL: () => null }, channels: { fetch: async () => ({
    messages: { edit: async () => { edits++; } },
  }) } };
  await ui.publicar(client, 1, [player]);
  await ui.publicar(client, 1, [player]);
  assert.equal(edits, 1);
  await ui.publicar(client, 1, [{...player, platform: 'emulator'}]);
  assert.equal(edits, 2);
});
