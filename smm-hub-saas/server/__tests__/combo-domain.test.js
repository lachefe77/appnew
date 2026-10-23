const test = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { db, hashPassword } = require('../db');
const { purchase, definition } = require('../combo-domain');
test('Combo distribui centavos, é idempotente e reverte lote sem saldo', () => {
  const hash = hashPassword('Combo-password-123');
  const id = Number(
    db
      .prepare(
        "INSERT INTO users(uuid,name,email,password_hash,salt,api_key,balance_cents) VALUES(?,'Combo',?,?,?,?,10000)",
      )
      .run(
        crypto.randomUUID(),
        crypto.randomUUID() + '@test.invalid',
        hash.hash,
        hash.salt,
        crypto.randomUUID(),
      ).lastInsertRowid,
  );
  const service = db
    .prepare(
      "SELECT * FROM services WHERE status='active' ORDER BY price_per_k_cents LIMIT 1",
    )
    .get();
  const value = definition({
    name: 'Combo teste',
    items: [
      { service_id: service.id, quantity: service.min_quantity },
      { service_id: service.id, quantity: service.min_quantity },
    ],
    price_cents: 5001,
  });
  const cid = Number(
    db
      .prepare(
        'INSERT INTO combos(name,items_json,price_cents,regular_cents) VALUES(?,?,?,?)',
      )
      .run(
        value.name,
        JSON.stringify(value.items),
        value.price_cents,
        value.regular_cents,
      ).lastInsertRowid,
  );
  const input = {
    request_id: crypto.randomUUID(),
    links: ['https://example.com/a', 'https://example.com/b'],
  };
  const result = purchase(id, cid, input);
  assert.equal(result.charged_cents, 5001);
  assert.equal(result.order_ids.length, 2);
  assert.equal(
    db
      .prepare('SELECT SUM(charge_cents) AS total FROM orders WHERE user_id=?')
      .get(id).total,
    5001,
  );
  assert.equal(purchase(id, cid, input).repeated, true);
  assert.equal(
    db.prepare('SELECT balance_cents FROM users WHERE id=?').get(id)
      .balance_cents,
    4999,
  );
  assert.throws(() =>
    purchase(id, cid, {
      ...input,
      links: ['https://example.com/changed', 'https://example.com/b'],
    }),
  );
  const count = db
    .prepare('SELECT COUNT(*) AS n FROM orders WHERE user_id=?')
    .get(id).n;
  assert.throws(() =>
    purchase(id, cid, { ...input, request_id: crypto.randomUUID() }),
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM orders WHERE user_id=?').get(id).n,
    count,
  );
  assert.equal(
    db.prepare('SELECT balance_cents FROM users WHERE id=?').get(id)
      .balance_cents,
    4999,
  );
  assert.throws(() =>
    purchase(id, cid, {
      request_id: crypto.randomUUID(),
      links: ['javascript:alert(1)', 'https://example.com/b'],
    }),
  );
});
