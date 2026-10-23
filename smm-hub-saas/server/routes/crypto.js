const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const {
  createCryptoInvoice,
  processCryptoPayment,
  verifyNowPaymentsSignature,
} = require('../crypto-gateway');
const config = require('../config');
const logger = require('../logger');

const router = express.Router();

router.post('/create', requireAuth, async (req, res) => {
  try {
    const { currency, amount_usd } = req.body;
    const n = parseFloat(amount_usd);
    if (!Number.isFinite(n) || n < 5)
      return res.status(400).json({ error: 'Valor mínimo: $5.00 USD.' });
    const curr = currency || 'USDT_TRC20';
    if (!['BTC', 'USDT_TRC20', 'USDT_BEP20'].includes(curr) || n > 10000)
      return res.status(400).json({ error: 'Moeda ou valor não suportado.' });
    const invoice = await createCryptoInvoice(req.user.id, n, curr);
    res.status(201).json({ message: 'Fatura Cripto gerada!', invoice });
  } catch (err) {
    res.status(err.status || 503).json({
      error: err.status
        ? err.message
        : 'Recebimento cripto ainda indisponível.',
    });
  }
});

router.post('/simulate-pay', requireAuth, (req, res) =>
  res.status(403).json({ error: 'Confirmação simulada pública desativada.' })
);

router.post(
  '/webhook',
  express.raw({ type: '*/*', limit: '1mb' }),
  async (req, res) => {
    try {
      const rawBody = Buffer.isBuffer(req.body)
        ? req.body.toString('utf-8')
        : JSON.stringify(req.body || {});
      const ok = verifyNowPaymentsSignature(req.headers, rawBody);
      if (!ok)
        return res.status(401).json({ error: 'Assinatura IPN inválida.' });
      const body = JSON.parse(rawBody);
      if (body.payment_status === 'finished') {
        const txid = `NOW${body.payment_id}`;
        const invoice = db
          .prepare('SELECT * FROM crypto_invoices WHERE txid=?')
          .get(txid);
        const expected = invoice?.currency
          .toLowerCase()
          .replace('_trc20', 'trc20')
          .replace('_bep20', 'bsc');
        if (
          !invoice ||
          body.pay_currency !== expected ||
          !invoice.amount_crypto_text ||
          !invoice.merchant_order_id ||
          body.order_id !== invoice.merchant_order_id ||
          !require('../decimal-amount').atLeast(
            body.actually_paid,
            invoice.amount_crypto_text
          )
        )
          return res
            .status(409)
            .json({ error: 'Pagamento requer conciliação de ativo e valor.' });
        const result = processCryptoPayment(txid);
        return res.json({ received: true, result });
      }
      res.json({ received: true, status: body.payment_status });
    } catch (err) {
      logger.error({ err: err.message }, 'Webhook cripto falhou');
      res.status(400).json({ error: err.message });
    }
  }
);

router.get('/status/:txid', requireAuth, (req, res) => {
  const invoice = db
    .prepare('SELECT * FROM crypto_invoices WHERE txid = ? AND user_id = ?')
    .get(req.params.txid, req.user.id);
  if (!invoice)
    return res.status(404).json({ error: 'Fatura não encontrada.' });
  res.json({ invoice });
});

module.exports = router;
