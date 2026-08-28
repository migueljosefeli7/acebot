const crypto = require('node:crypto');
const cfg = require('../config');
const money = require('../lib/money');

let payment = null;
if (!cfg.fakePayments) {
  const { MercadoPagoConfig, Payment } = require('mercadopago');
  const client = new MercadoPagoConfig({
    accessToken: cfg.mpAccessToken,
    options: { timeout: 10000 },
  });
  payment = new Payment(client);
}

/**
 * Cria uma cobranca PIX.
 * Retorna { id, qrCode (copia e cola), qrBase64, ticketUrl, expiresAt }
 */
async function criarPix({ amount, userId, username, depositId }) {
  const expiresAt = Date.now() + cfg.pixExpiraMinutos * 60 * 1000;

  if (cfg.fakePayments) {
    // Modo teste: nao chama o gateway. O PIX e "aprovado" pelo botao JA PAGUEI.
    return {
      id: 'FAKE-' + crypto.randomBytes(6).toString('hex'),
      qrCode: '00020126FAKE-PIX-DE-TESTE-' + depositId + '-' + amount,
      qrBase64: null,
      ticketUrl: null,
      expiresAt,
      fake: true,
    };
  }

  const res = await payment.create({
    body: {
      transaction_amount: money.toReais(amount),
      description: `Deposito ZE BOT - ${username}`,
      payment_method_id: 'pix',
      date_of_expiration: new Date(expiresAt).toISOString(),
      notification_url: `${cfg.publicUrl}/webhook/mercadopago`,
      external_reference: String(depositId),
      payer: {
        // Mercado Pago exige um email. Sem email real do jogador, usamos um sintetico.
        email: `player${userId}@zebot.local`,
        first_name: (username || 'Player').slice(0, 40),
      },
      metadata: { deposit_id: depositId, discord_id: userId },
    },
    requestOptions: { idempotencyKey: `dep-${depositId}` },
  });

  const tx = res.point_of_interaction?.transaction_data || {};
  return {
    id: String(res.id),
    qrCode: tx.qr_code,
    qrBase64: tx.qr_code_base64 || null,
    ticketUrl: tx.ticket_url || null,
    expiresAt,
    fake: false,
  };
}

/** Consulta um pagamento. Retorna { status, amount, externalReference } */
async function consultar(paymentId) {
  if (cfg.fakePayments) return { status: 'approved', amount: null, externalReference: null };
  const res = await payment.get({ id: paymentId });
  return {
    status: res.status, // approved | pending | rejected | cancelled
    amount: Math.round((res.transaction_amount || 0) * 100),
    externalReference: res.external_reference || null,
  };
}

module.exports = { criarPix, consultar };
