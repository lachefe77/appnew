const { db } = require('./db');
const config = require('./config');
function available(method) {
  return method === 'pix'
    ? config.pix.provider === 'mercadopago' &&
        !!config.pix.mp.accessToken &&
        !!config.pix.mp.webhookSecret
    : ['bitcoin', 'usdt'].includes(method)
      ? config.crypto.provider === 'nowpayments' &&
        !!config.crypto.nowpayments.apiKey &&
        !!config.crypto.nowpayments.ipnSecret
      : false;
}
function validatePayment(method, cents) {
  const row = db
    .prepare('SELECT * FROM payment_methods_config WHERE method=?')
    .get(method);
  if (!row || !row.is_enabled)
    throw Object.assign(new Error('Método de pagamento indisponível.'), {
      status: 503,
    });
  if (
    !Number.isSafeInteger(cents) ||
    cents < row.min_amount_cents ||
    cents > row.max_amount_cents
  )
    throw Object.assign(new Error('Valor fora dos limites do método.'), {
      status: 400,
    });
  if (
    !available(method) &&
    !(
      config.env === 'test' ||
      (config.env !== 'production' &&
        (method === 'pix' ? config.pix.provider : config.crypto.provider) ===
          'mock')
    )
  )
    throw Object.assign(new Error('Recebimento ainda não configurado.'), {
      status: 503,
    });
  return row;
}
module.exports = { available, validatePayment };
