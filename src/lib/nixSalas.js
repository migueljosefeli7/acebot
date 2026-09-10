const crypto = require('node:crypto');
const cfg = require('../config');

class NixApiError extends Error {
  constructor(message, { status = 0, retryAfter = null, body = null } = {}) {
    super(message);
    this.name = 'NixApiError';
    this.status = status;
    this.retryAfter = retryAfter;
    this.body = body;
  }
}

function configuracaoDaSala(match) {
  const modalidade = String(match.modalidade || '').toLowerCase();
  const configType = modalidade.includes('tático') || modalidade.includes('tatico')
    ? 'tatico'
    : match.gelo === 'INFINITO' ? 'gelo_inf' : 'ap_padrao';

  return {
    password: String(crypto.randomInt(100000, 1000000)),
    start_delay_minutes: cfg.nixSalas.startDelayMinutes,
    config_type: configType,
    room_name: `${cfg.nomeBot} #${match.id}`.slice(0, 30),
    '1500_ouro': false,
  };
}

async function requisitar(path, { method = 'GET', body } = {}) {
  if (!cfg.nixSalas.apiKey) throw new NixApiError('NIX_API_KEY não configurada no .env');

  let response;
  try {
    response = await fetch(`${cfg.nixSalas.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.nixSalas.apiKey}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(cfg.nixSalas.timeoutMs),
    });
  } catch (error) {
    throw new NixApiError(`Falha de conexão com a Nix: ${error.message}`);
  }

  const texto = await response.text();
  let payload = null;
  try { payload = texto ? JSON.parse(texto) : null; } catch { payload = texto; }

  if (!response.ok) {
    const detalhe = payload?.detail || payload?.message || texto || response.statusText;
    throw new NixApiError(`Nix API ${response.status}: ${detalhe}`, {
      status: response.status,
      retryAfter: response.headers.get('retry-after'),
      body: payload,
    });
  }
  return payload;
}

const criarSala = (match) => requisitar('/rooms', {
  method: 'POST',
  body: configuracaoDaSala(match),
}).then((sala) => {
  if (!sala?.session_id || sala.room_id == null || !sala.password) {
    throw new NixApiError('A Nix retornou uma resposta incompleta ao criar a sala', { body: sala });
  }
  return sala;
});

const iniciarSala = (sessionId) => requisitar(`/rooms/${encodeURIComponent(sessionId)}/start`, {
  method: 'POST',
});

const liberarSala = (sessionId) => requisitar(`/rooms/${encodeURIComponent(sessionId)}/release`, {
  method: 'POST',
});

module.exports = { NixApiError, configuracaoDaSala, criarSala, iniciarSala, liberarSala };
