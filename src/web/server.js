const express = require('express');
const db = require('../db/database');
const cfg = require('../config');
const mp = require('../payments/mercadopago');
const carteira = require('../features/carteira');

/**
 * Servidor que recebe o webhook do Mercado Pago.
 * Regra de ouro: responder 200 rapido. Se demorar, o MP reenvia o evento —
 * por isso confirmarDeposito() e idempotente.
 */
function iniciarWebhook(client) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, bot: client.user?.tag || null }));

  app.post('/webhook/mercadopago', async (req, res) => {
    res.sendStatus(200);

    try {
      const tipo = req.body?.type || req.body?.topic;
      const paymentId = req.body?.data?.id || req.query?.['data.id'] || req.body?.resource;
      if (tipo !== 'payment' || !paymentId) return;

      const info = await mp.consultar(String(paymentId));
      if (info.status !== 'approved') return;

      // Casa pelo external_reference (id do deposito) e, no fallback, pelo id do pagamento.
      let dep = info.externalReference
        ? db.prepare('SELECT * FROM deposits WHERE id = ?').get(Number(info.externalReference))
        : null;
      if (!dep) dep = db.prepare('SELECT * FROM deposits WHERE mp_payment_id = ?').get(String(paymentId));
      if (!dep) return console.warn('[webhook] pagamento sem deposito correspondente:', paymentId);

      // Nunca credita valor diferente do que foi cobrado.
      if (info.amount && info.amount !== dep.amount) {
        return console.error(`[webhook] valor divergente no deposito #${dep.id}: cobrado ${dep.amount}, pago ${info.amount}`);
      }

      const r = await carteira.confirmarDeposito(client, dep.id, { guildId: cfg.guildId });
      if (r.ok && !r.jaCreditado) console.log(`[webhook] deposito #${dep.id} creditado (${dep.amount} centavos)`);
    } catch (e) {
      console.error('[webhook] erro:', e.message);
    }
  });

  app.listen(cfg.webhookPort, () => {
    console.log(`🌐 Webhook ouvindo na porta ${cfg.webhookPort}`);
    console.log(`   URL que o Mercado Pago deve chamar: ${cfg.publicUrl || '(PUBLIC_URL nao configurada)'}/webhook/mercadopago`);
  });
}

module.exports = { iniciarWebhook };
