const crypto = require('node:crypto');
const QRCode = require('qrcode');
const { db, creditBalanceAtomic, recalcTier, tx } = require('./db');
const config = require('./config');
const logger = require('./logger');

/**
 * Adapter de criptomoedas. Suporta:
 *   - mock: carteiras fixas, confirmação manual via endpoint simulate-pay
 *   - nowpayments: integração real com confirmação on-chain via IPN
 */

const MOCK_WALLETS = {
  USDT_TRC20: 'TYk7B91xNqmQ8aC4sE7p2L5j8v01m2N3o4',
  BTC: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  SOL: '7v9h0P1m2N3o4P5q6R7s8T9u0V1w2X3y4Z5a6B7c8D9',
  USDT_BEP20: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
  ETH: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
};

async function createMockCryptoInvoice(userId, amountUSD, currency) {
  const walletAddress = MOCK_WALLETS[currency] || MOCK_WALLETS.USDT_TRC20;
  const txid = 'CRYPTO_' + crypto.randomBytes(6).toString('hex').toUpperCase();
  const qrCodeDataUrl = await QRCode.toDataURL(walletAddress, {
    margin: 2,
    width: 280,
  });

  return {
    txid,
    external_id: null,
    walletAddress,
    qrCodeDataUrl,
    provider: 'mock',
  };
}

async function createNowPaymentsInvoice(userId, amountUSD, currency) {
  if (!config.crypto.nowpayments.apiKey) {
    throw new Error('NOWPAYMENTS_API_KEY não configurado.');
  }
  const payCurrency = currency
    .toLowerCase()
    .replace('_trc20', 'trc20')
    .replace('_bep20', 'bsc');
  const body = {
    price_amount: amountUSD,
    price_currency: 'usd',
    pay_currency: payCurrency,
    order_id: `SMMHUB-${userId}-${crypto.randomUUID()}`,
    order_description: `Depósito SMM Hub #${userId}`,
    ipn_callback_url: config.publicUrl + '/api/wallet/crypto/webhook',
  };

  const res = await fetch('https://api.nowpayments.io/v1/payment', {
    method: 'POST',
    headers: {
      'x-api-key': config.crypto.nowpayments.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok)
    throw new Error(`NOWPayments ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const payAmount = require('./decimal-amount').canonical(data.pay_amount);
  if (
    data.pay_currency !== payCurrency ||
    !data.payment_id ||
    typeof data.pay_address !== 'string' ||
    !data.pay_address
  )
    throw new Error('Resposta de pagamento inconsistente.');

  const qrCodeDataUrl = await QRCode.toDataURL(data.pay_address, {
    margin: 2,
    width: 280,
  });

  return {
    txid: `NOW${data.payment_id}`,
    external_id: String(data.payment_id),
    walletAddress: data.pay_address,
    qrCodeDataUrl,
    provider: 'nowpayments',
    pay_amount: payAmount,
    merchant_order_id: body.order_id,
  };
}

async function createCryptoInvoice(userId, amountUSD, currency) {
  const usdSetting = db
    .prepare("SELECT value FROM settings WHERE key = 'current_usd_brl'")
    .get();
  const rate = usdSetting ? parseFloat(usdSetting.value) : 5.6;
  const amountBRLCents = Math.round(amountUSD * rate * 100);
  require('./payment-policy').validatePayment(
    currency === 'BTC'
      ? 'bitcoin'
      : currency.startsWith('USDT_')
        ? 'usdt'
        : 'unsupported',
    amountBRLCents
  );

  let gw;
  if (config.crypto.provider === 'nowpayments') {
    gw = await createNowPaymentsInvoice(userId, amountUSD, currency);
  } else if (config.crypto.provider === 'mock' && config.env !== 'production') {
    gw = await createMockCryptoInvoice(userId, amountUSD, currency);
  } else {
    throw new Error('Cripto não configurada para recebimento.');
  }

  db.prepare(
    `
    INSERT INTO crypto_invoices (txid, external_id, user_id, currency, amount_crypto, amount_brl_cents, wallet_address, qr_code_data_url,amount_crypto_text,merchant_order_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,?,'pending')
  `
  ).run(
    gw.txid,
    gw.external_id,
    userId,
    currency,
    gw.pay_amount || amountUSD,
    amountBRLCents,
    gw.walletAddress,
    gw.qrCodeDataUrl,
    require('./decimal-amount').canonical(gw.pay_amount || amountUSD),
    gw.merchant_order_id || null
  );

  return {
    txid: gw.txid,
    provider: gw.provider,
    currency,
    amount_crypto: gw.pay_amount || amountUSD,
    amount_brl_formatted: `R$ ${(amountBRLCents / 100).toFixed(2).replace('.', ',')}`,
    wallet_address: gw.walletAddress,
    qr_code_data_url: gw.qrCodeDataUrl,
  };
}

function processCryptoPayment(txid) {
  return tx(() => {
    const invoice = db
      .prepare('SELECT * FROM crypto_invoices WHERE txid = ?')
      .get(txid);
    if (!invoice) throw new Error('Fatura Cripto não encontrada.');
    if (invoice.status === 'paid') return { already_paid: true };
    if (invoice.status !== 'pending')
      throw new Error('Fatura não está pendente.');

    db.prepare(
      `UPDATE crypto_invoices SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`
    ).run(invoice.id);

    const user = db
      .prepare('SELECT id, total_deposited_cents FROM users WHERE id = ?')
      .get(invoice.user_id);
    const newBalance = creditBalanceAtomic(user.id, invoice.amount_brl_cents);
    db.prepare(
      'UPDATE users SET total_deposited_cents = total_deposited_cents + ? WHERE id = ?'
    ).run(invoice.amount_brl_cents, user.id);
    const tier = recalcTier(user.id);

    db.prepare(
      `
      INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents, reference_id, description)
      VALUES (?, 'deposit_crypto', ?, ?, ?, ?)
    `
    ).run(
      user.id,
      invoice.amount_brl_cents,
      newBalance,
      txid,
      `Depósito Cripto Aprovado (${invoice.amount_crypto} ${invoice.currency})`
    );

    logger.info(
      { userId: user.id, txid, currency: invoice.currency },
      'Cripto confirmado'
    );
    return { success: true, new_balance_cents: newBalance, tier: tier.name };
  });
}

function verifyNowPaymentsSignature(headers, rawBody) {
  if (!config.crypto.nowpayments.ipnSecret) return false;
  const sig = headers['x-nowpayments-sig'];
  if (!sig) return false;
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((k) => [k, canonical(value[k])])
      );
    return value;
  }
  const sorted = JSON.stringify(canonical(JSON.parse(rawBody)));
  const expected = crypto
    .createHmac('sha512', config.crypto.nowpayments.ipnSecret)
    .update(sorted)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(sig, 'hex')
    );
  } catch {
    return false;
  }
}

module.exports = {
  createCryptoInvoice,
  processCryptoPayment,
  verifyNowPaymentsSignature,
  MOCK_WALLETS,
};
