const crypto = require('node:crypto');
const QRCode = require('qrcode');
const {
  db,
  calculateTier,
  creditBalanceAtomic,
  recalcTier,
  tx,
} = require('./db');
const config = require('./config');
const logger = require('./logger');
const { sendMail } = require('./mail');
const metrics = require('./metrics');

const PIX_EXPIRATION_SECONDS = 900; // 15 min

/* ========= EMV / BRCode (fallback mock) ========= */

function getCRC16(payload) {
  let crc = 0xffff;
  const polynomial = 0x1021;
  const bytes = Buffer.from(payload, 'utf-8');
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) crc = ((crc << 1) ^ polynomial) & 0xffff;
      else crc = (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function emvField(id, value) {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

function generatePixBRCode({
  pixKey,
  merchantName,
  merchantCity,
  txid,
  amountBRL,
}) {
  const cleanKey = (pixKey || config.pix.key).trim();
  const cleanName = (merchantName || config.pix.merchantName).substring(0, 25);
  const cleanCity = (merchantCity || config.pix.merchantCity).substring(0, 15);
  const formattedAmount = Number(amountBRL).toFixed(2);

  const gui = emvField('00', 'br.gov.bcb.pix');
  const key = emvField('01', cleanKey);
  const f26 = emvField('26', `${gui}${key}`);
  const f05 = emvField('05', txid.substring(0, 25));
  const f62 = emvField('62', f05);

  let payload = '';
  payload += emvField('00', '01');
  payload += f26;
  payload += emvField('52', '0000');
  payload += emvField('53', '986');
  payload += emvField('54', formattedAmount);
  payload += emvField('58', 'BR');
  payload += emvField('59', cleanName);
  payload += emvField('60', cleanCity);
  payload += f62;
  payload += '6304';

  const crc = getCRC16(payload);
  return `${payload}${crc}`;
}

/* ========= Gateway adapters ========= */

async function createMockInvoice(amountCents) {
  const txid =
    'SMM' +
    Date.now().toString(36).toUpperCase() +
    crypto.randomBytes(4).toString('hex').toUpperCase();
  const amountBRL = (amountCents / 100).toFixed(2);
  const copyPaste = generatePixBRCode({ txid, amountBRL });
  const qrCodeDataUrl = await QRCode.toDataURL(copyPaste, {
    errorCorrectionLevel: 'M',
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
    width: 320,
  });
  return {
    txid,
    external_id: null,
    copyPaste,
    qrCodeDataUrl,
    provider: 'mock',
  };
}

async function createMercadoPagoInvoice(amountCents, { userId, email }) {
  if (!config.pix.mp.accessToken) {
    throw new Error('MP_ACCESS_TOKEN não configurado. Defina em .env.');
  }
  const idempotencyKey = crypto.randomUUID();
  const body = {
    transaction_amount: amountCents / 100,
    description: `Depósito SMM Hub #${userId}`,
    payment_method_id: 'pix',
    payer: { email: email || `user${userId}@smmhub.local` },
    external_reference: `SMMHUB-${userId}-${Date.now()}`,
    date_of_expiration: new Date(
      Date.now() + PIX_EXPIRATION_SECONDS * 1000
    ).toISOString(),
  };

  const res = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.pix.mp.accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Mercado Pago ${res.status}: ${err}`);
  }

  const data = await res.json();
  const poi =
    data.point_of_interaction && data.point_of_interaction.transaction_data;
  if (!poi || !poi.qr_code)
    throw new Error('Mercado Pago não retornou QR code.');

  const qrCodeDataUrl = await QRCode.toDataURL(poi.qr_code, {
    margin: 2,
    width: 320,
  });

  return {
    txid: `MP${data.id}`,
    external_id: String(data.id),
    copyPaste: poi.qr_code,
    qrCodeDataUrl,
    provider: 'mercadopago',
  };
}

async function createEfiInvoice(amountCents, { userId, email }) {
  if (!config.pix.efi.clientId || !config.pix.efi.clientSecret) {
    throw new Error('EFI_CLIENT_ID / EFI_CLIENT_SECRET não configurados.');
  }
  throw new Error(
    'Integração Efí Bank requer certificado P12 e endpoints OAuth2 — habilite após instalar lib oficial sdk-node-apis-efi.'
  );
}

async function createPixInvoice(userId, amountCents, opts = {}) {
  require('./payment-policy').validatePayment('pix', amountCents);
  const provider = config.pix.provider;
  let gw;

  if (provider === 'mercadopago') {
    gw = await createMercadoPagoInvoice(amountCents, {
      userId,
      email: opts.email,
    });
  } else if (provider === 'efi') {
    gw = await createEfiInvoice(amountCents, { userId, email: opts.email });
  } else if (provider === 'mock' && config.env !== 'production') {
    gw = await createMockInvoice(amountCents);
  } else {
    throw new Error('Pix não configurado para recebimento.');
  }

  const expiresAt = new Date(
    Date.now() + PIX_EXPIRATION_SECONDS * 1000
  ).toISOString();

  db.prepare(
    `
    INSERT INTO pix_invoices (txid, external_id, provider, user_id, amount_cents, qr_code_data_url, copy_paste, status, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `
  ).run(
    gw.txid,
    gw.external_id,
    gw.provider,
    userId,
    amountCents,
    gw.qrCodeDataUrl,
    gw.copyPaste,
    expiresAt
  );

  logger.info(
    { userId, provider: gw.provider, amountCents, txid: gw.txid },
    'Pix invoice criado'
  );

  return {
    txid: gw.txid,
    provider: gw.provider,
    amount_cents: amountCents,
    amount_formatted: `R$ ${(amountCents / 100).toFixed(2).replace('.', ',')}`,
    qr_code_data_url: gw.qrCodeDataUrl,
    copy_paste: gw.copyPaste,
    expires_in_seconds: PIX_EXPIRATION_SECONDS,
    expires_at: expiresAt,
  };
}

/* ========= Pagamento confirmado — idempotente ========= */

function processPixPayment(txid) {
  const result = tx(() => {
    const invoice = db
      .prepare('SELECT * FROM pix_invoices WHERE txid = ?')
      .get(txid);
    if (!invoice) throw new Error('Fatura Pix não encontrada.');
    if (invoice.status === 'paid') return { already_paid: true };
    if (invoice.status !== 'pending')
      throw new Error('Fatura não está pendente.');

    db.prepare(
      `UPDATE pix_invoices SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`
    ).run(invoice.id);

    const confirm = db
      .prepare('SELECT status FROM pix_invoices WHERE id = ?')
      .get(invoice.id);
    if (confirm.status !== 'paid') return { already_paid: true, invoice };

    const user = db
      .prepare(
        'SELECT id, balance_cents, total_deposited_cents, referred_by FROM users WHERE id = ?'
      )
      .get(invoice.user_id);
    const newBalance = creditBalanceAtomic(user.id, invoice.amount_cents);
    const newTotalDeposited =
      (user.total_deposited_cents || 0) + invoice.amount_cents;
    db.prepare('UPDATE users SET total_deposited_cents = ? WHERE id = ?').run(
      newTotalDeposited,
      user.id
    );
    const tier = recalcTier(user.id);

    db.prepare(
      `
      INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents, reference_id, description)
      VALUES (?, 'deposit_pix', ?, ?, ?, ?)
    `
    ).run(
      user.id,
      invoice.amount_cents,
      newBalance,
      txid,
      `Depósito aprovado via Pix (R$ ${(invoice.amount_cents / 100).toFixed(2)}) — ${invoice.provider}`
    );

    // Comissões multinível L1-L4 com anti-fraude (conta recente não gera comissão)
    const commissions = { l1: 0, l2: 0, l3: 0, l4: 0 };
    const pcts = [
      Number(
        db
          .prepare("SELECT value FROM settings WHERE key='affiliate_l1_pct'")
          .get()?.value ?? 5
      ),
      Number(
        db
          .prepare("SELECT value FROM settings WHERE key='affiliate_l2_pct'")
          .get()?.value ?? 2
      ),
      Number(
        db
          .prepare("SELECT value FROM settings WHERE key='affiliate_l3_pct'")
          .get()?.value ?? 1
      ),
      Number(
        db
          .prepare("SELECT value FROM settings WHERE key='affiliate_l4_pct'")
          .get()?.value ?? 0.5
      ),
    ];

    const minHoursSetting = db
      .prepare("SELECT value FROM settings WHERE key='min_account_hours'")
      .get();
    const minHours = minHoursSetting
      ? parseFloat(minHoursSetting.value)
      : config.affiliate.minAccountHours;

    const visited = new Set([user.id]);
    let currentRefId = user.referred_by;
    for (let level = 1; level <= 4 && currentRefId; level++) {
      const ref = db
        .prepare(
          'SELECT id, balance_cents, referred_by, created_at FROM users WHERE id = ?'
        )
        .get(currentRefId);
      if (!ref || visited.has(ref.id)) break;
      visited.add(ref.id);

      const ageMs = Date.now() - new Date(ref.created_at).getTime();
      const ageHours = ageMs / 3_600_000;
      if (ageHours < minHours) {
        logger.info(
          { refId: ref.id, ageHours, level },
          'Comissão suprimida: conta recente (anti-fraude)'
        );
        currentRefId = ref.referred_by;
        continue;
      }

      const pct = pcts[level - 1];
      const comm = Math.round(invoice.amount_cents * (pct / 100));
      if (comm > 0) {
        const bal = creditBalanceAtomic(ref.id, comm);
        db.prepare(
          `INSERT INTO referral_commissions (referrer_id, referred_id, level, deposit_amount_cents, commission_cents)
          VALUES (?, ?, ?, ?, ?)`
        ).run(ref.id, user.id, level, invoice.amount_cents, comm);
        db.prepare(
          `INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents, reference_id, description)
          VALUES (?, 'affiliate_commission_l' || ?, ?, ?, ?, ?)`
        ).run(
          ref.id,
          level,
          comm,
          bal,
          txid,
          `Comissão Afiliado L${level} (${pct}% sobre R$ ${(invoice.amount_cents / 100).toFixed(2)})`
        );
        commissions['l' + level] = comm;
      }
      currentRefId = ref.referred_by;
    }

    const orderId = require('./checkout-fulfillment').fulfillCheckout(invoice);
    metrics.inc('pix_paid_total');

    // Envia e-mail de confirmação (async, não bloqueia)
    const u = db
      .prepare('SELECT name, email FROM users WHERE id = ?')
      .get(user.id);
    if (u && u.email && !u.email.endsWith('@anonymized.local')) {
      sendMail(u.email, 'deposit_approved', {
        name: u.name,
        amount: invoice.amount_cents,
        newBalance,
      }).catch(() => {});
    }

    logger.info(
      { userId: user.id, txid, amount: invoice.amount_cents, commissions },
      'Pix confirmado'
    );
    return {
      success: true,
      invoice_id: invoice.id,
      txid,
      order_id: orderId,
      amount_cents: invoice.amount_cents,
      new_balance_cents: db
        .prepare('SELECT balance_cents FROM users WHERE id=?')
        .get(user.id).balance_cents,
      tier: tier.name,
      commissions,
    };
  });
  if (result.order_id)
    queueMicrotask(() =>
      require('./smm-engine')
        .dispatchOrder(result.order_id)
        .catch(() => {})
    );
  return result;
}

/* ========= Verificação de assinatura de webhook ========= */

function verifyMercadoPagoSignature(headers, body) {
  if (!config.pix.mp.webhookSecret) return false; // Config opcional
  const xSig = headers['x-signature'] || '';
  const xReq = headers['x-request-id'] || '';
  const parts = Object.fromEntries(
    xSig.split(',').map((p) => p.trim().split('='))
  );
  if (!parts.ts || !parts.v1) return false;

  const dataId = (body && body.data && body.data.id) || '';
  const manifest = `id:${dataId};request-id:${xReq};ts:${parts.ts};`;
  const expected = crypto
    .createHmac('sha256', config.pix.mp.webhookSecret)
    .update(manifest)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(parts.v1, 'hex')
    );
  } catch {
    return false;
  }
}

async function fetchMercadoPagoPayment(paymentId) {
  const res = await fetch(
    `https://api.mercadopago.com/v1/payments/${paymentId}`,
    {
      headers: { Authorization: `Bearer ${config.pix.mp.accessToken}` },
      signal: AbortSignal.timeout(10000),
    }
  );
  if (!res.ok) throw new Error(`MP fetch ${res.status}`);
  return res.json();
}

module.exports = {
  createPixInvoice,
  processPixPayment,
  generatePixBRCode,
  verifyMercadoPagoSignature,
  fetchMercadoPagoPayment,
};
