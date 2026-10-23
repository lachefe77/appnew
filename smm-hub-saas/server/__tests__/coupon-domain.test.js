const test = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { db, hashPassword } = require('../db');
const { validateCoupon } = require('../coupon-domain');
test('Cupom de primeira compra e cotação compartilham elegibilidade', () => {
  const h = hashPassword('Coupon-test-12345');
  const id = db
    .prepare(
      "INSERT INTO users(uuid,name,email,password_hash,salt,api_key,balance_cents) VALUES(?,'Coupon',?,?,?,?,100000)"
    )
    .run(
      crypto.randomUUID(),
      crypto.randomUUID() + '@test.invalid',
      h.hash,
      h.salt,
      crypto.randomUUID()
    ).lastInsertRowid;
  const service = db
    .prepare("SELECT * FROM services WHERE status='active' ORDER BY id LIMIT 1")
    .get();
  assert.equal(validateCoupon(id, 'BEMVINDO10', 1000).discount, 100);
  assert.throws(() => validateCoupon(id, 'BEMVINDO10', 999));
  assert.throws(() => validateCoupon(id, {}, 1000));
  const quantity = Math.max(
    service.min_quantity,
    Math.ceil(150000 / service.price_per_k_cents)
  );
  require('../order-domain').placeOrder(id, {
    service_id: service.id,
    quantity,
    link: 'https://example.com/coupon',
  });
  assert.throws(
    () => validateCoupon(id, 'BEMVINDO10', 1000),
    /primeira compra/
  );
});
