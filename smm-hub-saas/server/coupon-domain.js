const { db } = require('./db');
function validateCoupon(userId, code, amount) {
  const fail = (message) => {
    throw Object.assign(new Error(message), { status: 400 });
  };
  if (
    typeof code !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(code.trim()) ||
    !Number.isSafeInteger(amount) ||
    amount < 0
  )
    fail('Cupom ou valor inválido.');
  const coupon = db
    .prepare("SELECT * FROM coupons WHERE code=? AND status='active'")
    .get(code.trim().toUpperCase());
  if (
    !coupon ||
    (coupon.expires_at &&
      (!Number.isFinite(Date.parse(coupon.expires_at)) ||
        Date.parse(coupon.expires_at) <= Date.now())) ||
    (coupon.max_uses > 0 && coupon.uses_count >= coupon.max_uses) ||
    amount < coupon.min_order_cents
  )
    fail('Cupom inválido, expirado, esgotado ou valor abaixo do mínimo.');
  if (
    db
      .prepare('SELECT id FROM coupon_uses WHERE coupon_id=? AND user_id=?')
      .get(coupon.id, userId)
  )
    fail('Cupom já utilizado nesta conta.');
  if (
    (coupon.first_purchase_only || coupon.code === 'BEMVINDO10') &&
    db.prepare('SELECT id FROM orders WHERE user_id=? LIMIT 1').get(userId)
  )
    fail('Cupom exclusivo para a primeira compra.');
  if (
    !Number.isSafeInteger(coupon.discount_pct) ||
    coupon.discount_pct < 0 ||
    coupon.discount_pct > 100 ||
    !Number.isSafeInteger(coupon.fixed_cents) ||
    coupon.fixed_cents < 0
  )
    fail('Configuração de cupom inválida.');
  const discount = Math.min(
    amount,
    coupon.discount_pct > 0
      ? Math.round((amount * coupon.discount_pct) / 100)
      : coupon.fixed_cents
  );
  return { coupon, discount };
}
module.exports = { validateCoupon };
