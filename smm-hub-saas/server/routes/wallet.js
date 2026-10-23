const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const {
  createPixInvoice,
  processPixPayment,
  verifyMercadoPagoSignature,
  fetchMercadoPagoPayment,
} = require('../pix');
const config = require('../config');
const logger = require('../logger');

const router = express.Router();

router.post('/pix/create', requireAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    const n = parseFloat(amount);
    const minSetting = db
      .prepare("SELECT value FROM settings WHERE key='min_deposit_brl'")
      .get();
    const minBRL = minSetting ? parseFloat(minSetting.value) : 5;

    if (!Number.isFinite(n) || n < minBRL)
      return res
        .status(400)
        .json({ error: `Valor mínimo para Pix é R$ ${minBRL.toFixed(2)}.` });
    if (n > 10000)
      return res
        .status(400)
        .json({ error: 'Valor máximo por transação é R$ 10.000,00.' });

    const invoice = await createPixInvoice(req.user.id, Math.round(n * 100), {
      email: req.user.email,
    });
    res.status(201).json({ message: 'Cobrança Pix gerada!', invoice });
  } catch (err) {
    logger.error({ err: err.message }, 'Create pix error');
    res.status(err.status || 503).json({
      error: err.status ? err.message : 'Recebimento Pix ainda indisponível.',
    });
  }
});

router.get('/pix/status/:txid', requireAuth, (req, res) => {
  const invoice = db
    .prepare(
      'SELECT status, paid_at, expires_at, provider FROM pix_invoices WHERE txid = ? AND user_id = ?'
    )
    .get(req.params.txid, req.user.id);
  if (!invoice)
    return res.status(404).json({ error: 'Fatura Pix não encontrada.' });

  const user = db
    .prepare('SELECT balance_cents FROM users WHERE id = ?')
    .get(req.user.id);
  res.json({ ...invoice, current_balance_cents: user.balance_cents });
});

// Endpoint de simulação só habilitado quando provider = mock
router.post('/pix/simulate-pay', requireAuth, (req, res) =>
  res.status(403).json({ error: 'Confirmação simulada pública desativada.' })
);

router.post(
  '/pix/webhook',
  express.raw({ type: '*/*', limit: '1mb' }),
  async (req, res) => {
    try {
      const rawBody =
        req.body && Buffer.isBuffer(req.body)
          ? req.body.toString('utf-8')
          : JSON.stringify(req.body || {});
      let body;
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = {};
      }

      const provider = config.pix.provider;

      if (provider === 'mercadopago') {
        const ok = verifyMercadoPagoSignature(req.headers, body);
        try {
          require('../ops-desk').logWebhook(
            'pix',
            body?.data?.id,
            ok ? 'received' : 'rejected',
            rawBody
          );
        } catch {}
        if (!ok) {
          logger.warn('Webhook MP com assinatura inválida');
          return res.status(401).json({ error: 'Assinatura inválida.' });
        }
        const paymentId = body?.data?.id;
        if (!paymentId)
          return res.status(400).json({ error: 'payment id ausente' });

        const payment = await fetchMercadoPagoPayment(paymentId);
        if (payment.status === 'approved') {
          const local = db
            .prepare('SELECT * FROM pix_invoices WHERE txid=?')
            .get('MP' + payment.id);
          if (
            !local ||
            Math.round(Number(payment.transaction_amount) * 100) !==
              local.amount_cents ||
            payment.currency_id !== 'BRL'
          )
            return res
              .status(409)
              .json({ error: 'Pagamento requer conciliação.' });
          const txid = `MP${payment.id}`;
          const result = processPixPayment(txid);
          return res.json({ received: true, result });
        }
        return res.json({ received: true, status: payment.status });
      }

      return res
        .status(403)
        .json({ error: 'Provedor sem confirmação autenticada disponível.' });
      // Legacy payload parsing
      const txid = body.txid || body?.pix?.[0]?.txid || body.external_reference;
      if (!txid) return res.status(400).json({ error: 'TXID não encontrado.' });
      const result = processPixPayment(txid);
      res.json({ received: true, result });
    } catch (err) {
      logger.error({ err: err.message }, 'Webhook pix falhou');
      res.status(400).json({ error: err.message });
    }
  }
);

router.get('/transactions', requireAuth, (req, res) => {
  const { limit = 30, type } = req.query;
  let q = `SELECT id, type, amount_cents, balance_after_cents, reference_id, description, created_at
           FROM transactions WHERE user_id = ?`;
  const params = [req.user.id];
  if (type) {
    q += ' AND type = ?';
    params.push(type);
  }
  q += ' ORDER BY id DESC LIMIT ?';
  params.push(parseInt(limit, 10));
  res.json({ transactions: db.prepare(q).all(...params) });
});

module.exports = router;
