const { placeOrder, quoteOrder } = require('../order-domain');
const express = require('express');
const crypto = require('node:crypto');
const QRCode = require('qrcode');
const {
  db,
  hashPassword,
  debitBalanceAtomic,
  creditBalanceAtomic,
  recalcTier,
  tx,
} = require('../db');
const { generatePixBRCode, createPixInvoice } = require('../pix');
const { dispatchOrder } = require('../smm-engine');
const { signToken, verifyToken } = require('../auth');
const config = require('../config');

const router = express.Router();

function getOptionalUser(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const payload = verifyToken(authHeader.substring(7));
    if (
      payload &&
      payload.id &&
      !payload.sub_account_id &&
      !payload.delegated_by
    )
      return db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
  }
  return null;
}

router.post('/init', async (req, res) => {
  try {
    const {
      service_id,
      link,
      quantity,
      buyer_name,
      buyer_email,
      buyer_whatsapp,
      coupon_code,
      add_bump,
    } = req.body;
    if (!service_id || !link || !quantity)
      return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });

    const numQty = parseInt(quantity, 10);
    if (!Number.isFinite(numQty) || numQty <= 0)
      return res.status(400).json({ error: 'Quantidade inválida.' });

    const service = db
      .prepare("SELECT * FROM services WHERE id = ? AND status = 'active'")
      .get(service_id);
    if (!service)
      return res.status(404).json({ error: 'Serviço não encontrado.' });
    if (numQty < service.min_quantity || numQty > service.max_quantity) {
      return res.status(400).json({
        error: `Quantidade deve ser entre ${service.min_quantity} e ${service.max_quantity}.`,
      });
    }

    let rawChargeCents = Math.round(
      (service.price_per_k_cents * numQty) / 1000
    );
    if (rawChargeCents < 100) rawChargeCents = 100;

    let discountCents = 0;
    if (coupon_code) {
      const coup = db
        .prepare("SELECT * FROM coupons WHERE code = ? AND status = 'active'")
        .get(coupon_code.trim().toUpperCase());
      if (
        coup &&
        (!coup.expires_at || new Date(coup.expires_at) > new Date()) &&
        (!coup.max_uses || coup.uses_count < coup.max_uses) &&
        rawChargeCents >= coup.min_order_cents
      ) {
        if (coup.discount_pct > 0)
          discountCents = Math.round(
            rawChargeCents * (coup.discount_pct / 100)
          );
        else if (coup.fixed_cents > 0) discountCents = coup.fixed_cents;
      }
    }
    const bumpCents = add_bump ? 690 : 0;
    let finalCharge = Math.max(50, rawChargeCents - discountCents + bumpCents);

    const authUser = getOptionalUser(req);
    const targetEmail = (authUser ? authUser.email : buyer_email || '')
      .trim()
      .toLowerCase();
    const targetName = (
      authUser ? authUser.name : buyer_name || 'Cliente SMM'
    ).trim();
    if (!targetEmail)
      return res
        .status(400)
        .json({ error: 'E-mail do comprador é obrigatório.' });

    let user = db
      .prepare(
        'SELECT id, email, name, balance_cents FROM users WHERE email = ?'
      )
      .get(targetEmail);
    let tempPassword = null;

    if (!user) {
      tempPassword = crypto.randomBytes(18).toString('base64url');
      const passData = hashPassword(tempPassword);
      const uuid = crypto.randomUUID();
      const apiKey = 'smm_' + crypto.randomBytes(16).toString('hex');
      const refCode =
        'REF' + crypto.randomBytes(4).toString('hex').toUpperCase();
      const u = db
        .prepare(
          `
        INSERT INTO users (uuid, name, email, password_hash, salt, balance_cents, role, api_key, ref_code, whatsapp)
        VALUES (?, ?, ?, ?, ?, 0, 'user', ?, ?, ?)
      `
        )
        .run(
          uuid,
          targetName,
          targetEmail,
          passData.hash,
          passData.salt,
          apiKey,
          refCode,
          buyer_whatsapp || ''
        );
      user = {
        id: u.lastInsertRowid,
        email: targetEmail,
        name: targetName,
        balance_cents: 0,
      };
    }

    if (!authUser && !tempPassword)
      return res
        .status(401)
        .json({ error: 'Entre na sua conta para usar este e-mail.' });
    finalCharge = quoteOrder(user.id, {
      service_id,
      link,
      quantity: numQty,
      add_bump,
    }).charge_cents;
    if (coupon_code)
      return res
        .status(400)
        .json({ error: 'Use sua carteira para comprar com cupom.' });
    const sessionId = 'FAST_' + crypto.randomBytes(16).toString('hex');

    // Gera Pix pelo gateway configurado
    const pixInvoice = await createPixInvoice(user.id, finalCharge, {
      email: targetEmail,
    });

    db.prepare(
      `
      INSERT INTO fast_checkouts (
        session_id, service_id, link, quantity, amount_cents, buyer_name, buyer_email, buyer_whatsapp,
        txid, qr_code_data_url, copy_paste, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `
    ).run(
      sessionId,
      service.id,
      link.trim(),
      numQty,
      finalCharge,
      targetName,
      targetEmail,
      buyer_whatsapp || '',
      pixInvoice.txid,
      pixInvoice.qr_code_data_url,
      pixInvoice.copy_paste
    );

    res.status(201).json({
      session_id: sessionId,
      txid: pixInvoice.txid,
      service_name: service.name,
      platform: service.platform,
      quantity: numQty,
      amount_cents: finalCharge,
      amount_formatted: `R$ ${(finalCharge / 100).toFixed(2).replace('.', ',')}`,
      copy_paste: pixInvoice.copy_paste,
      qr_code_data_url: pixInvoice.qr_code_data_url,
      temporary_password: tempPassword,
      auto_created_account: !!tempPassword,
      user_balance_cents: authUser ? user.balance_cents : undefined,
      user_can_pay_with_balance:
        !!authUser && (user.balance_cents || 0) >= finalCharge,
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: 'Falha ao processar checkout: ' + err.message });
  }
});

router.post('/pay-with-wallet', async (req, res) => {
  try {
    const user = getOptionalUser(req);
    if (!user)
      return res.status(401).json({ error: 'Autenticação necessária.' });
    const result = placeOrder(user.id, req.body);
    dispatchOrder(result.id).catch(() => {});
    res.json({
      message: 'Pedido criado.',
      order_id: result.id,
      order_uuid: result.uuid,
      new_balance_cents: result.new_balance_cents,
      new_balance_formatted:
        'R$ ' + (result.new_balance_cents / 100).toFixed(2),
    });
  } catch (err) {
    res
      .status(err.status || 500)
      .json({ error: err.status ? err.message : 'Erro ao criar pedido.' });
  }
});

// Simulate paga APENAS em modo mock — credita saldo, debita e dispara ordem
router.post('/simulate-pay', (req, res) =>
  res.status(403).json({ error: 'Confirmação simulada pública desativada.' })
);

router.get('/:session_id', (req, res) => {
  const fast = db
    .prepare(
      `
    SELECT f.session_id,f.service_id,f.quantity,f.amount_cents,f.status,f.order_id,f.created_at,f.paid_at,o.uuid as order_uuid, o.status as order_status
    FROM fast_checkouts f LEFT JOIN orders o ON f.order_id = o.id
    WHERE f.session_id = ?
  `
    )
    .get(req.params.session_id);
  if (!fast) return res.status(404).json({ error: 'Sessão não encontrada.' });
  res.json({ checkout: fast });
});

module.exports = router;
