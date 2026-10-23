const test = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { db, hashPassword } = require('../db');
function user() {
  const h = hashPassword('Payment-fixture-123');
  const id = db
    .prepare(
      "INSERT INTO users(uuid,name,email,password_hash,salt,api_key,role,balance_cents) VALUES(?,'Payment',?,?,?,?,'user',10000)"
    )
    .run(
      crypto.randomUUID(),
      crypto.randomUUID() + '@test.invalid',
      h.hash,
      h.salt,
      crypto.randomUUID()
    ).lastInsertRowid;
  return db.prepare('SELECT * FROM users WHERE id=?').get(id);
}
test('Confirmação de checkout credita e compra uma vez, sem saldo duplicado', async () => {
  const u = user(),
    svc = db
      .prepare("SELECT * FROM services WHERE status='active' LIMIT 1")
      .get();
  const txid = crypto.randomUUID(),
    session = crypto.randomUUID();
  db.prepare(
    "INSERT INTO pix_invoices(txid,user_id,amount_cents,provider,qr_code_data_url,copy_paste) VALUES(?,?,1000,'mock','fixture','fixture')"
  ).run(txid, u.id);
  db.prepare(
    "INSERT INTO fast_checkouts(session_id,service_id,link,quantity,amount_cents,buyer_name,buyer_email,buyer_whatsapp,txid,qr_code_data_url,copy_paste) VALUES(?,?,?,?,1000,?,?,? ,?,'fixture','fixture')"
  ).run(
    session,
    svc.id,
    'https://instagram.com/test',
    svc.min_quantity,
    u.name,
    u.email,
    '',
    txid
  );
  const { processPixPayment } = require('../pix');
  const first = processPixPayment(txid);
  assert.ok(first.order_id);
  assert.equal(processPixPayment(txid).already_paid, true);
  const row = db
    .prepare('SELECT status,order_id FROM fast_checkouts WHERE session_id=?')
    .get(session);
  assert.equal(row.status, 'paid');
  assert.equal(row.order_id, first.order_id);
  assert.equal(
    db.prepare('SELECT balance_cents FROM users WHERE id=?').get(u.id)
      .balance_cents,
    10000
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM transactions WHERE type='deposit_pix' AND reference_id=?"
      )
      .get(txid).n,
    1
  );
});
test('Cotação compartilhada aplica regras e lote reverte integralmente', () => {
  const u = user(),
    svc = db
      .prepare("SELECT * FROM services WHERE status='active' LIMIT 1")
      .get();
  const { quoteOrder, placeOrder, placeBatch } = require('../order-domain');
  const input = {
    service_id: svc.id,
    quantity: svc.min_quantity,
    link: 'https://instagram.com/test',
  };
  const quote = quoteOrder(u.id, input),
    order = placeOrder(u.id, input);
  assert.equal(order.charge_cents, quote.charge_cents);
  const before = db
    .prepare('SELECT balance_cents FROM users WHERE id=?')
    .get(u.id).balance_cents;
  assert.throws(() => placeBatch(u.id, [input, { ...input, quantity: -1 }]));
  assert.equal(
    db.prepare('SELECT balance_cents FROM users WHERE id=?').get(u.id)
      .balance_cents,
    before
  );
  db.prepare(
    "INSERT INTO coupons(code,discount_pct,expires_at) VALUES('EXPIRED-REGRESSION',10,'2020-01-01')"
  ).run();
  assert.throws(() =>
    quoteOrder(u.id, { ...input, coupon_code: 'EXPIRED-REGRESSION' })
  );
});
test('Chaves de integração são criptografadas e não são expostas em respostas públicas', () => {
  const previous = process.env.SETTINGS_ENCRYPTION_KEY;
  process.env.SETTINGS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  const { write, read } = require('../runtime-config');
  const value = 'fixture-secret-' + crypto.randomUUID();
  try {
    write({ 'pix.mp.accessToken': value, 'pix.provider': 'disabled' });
    assert.equal(read('pix.mp.accessToken', ''), value);
    assert.equal(
      db
        .prepare(
          "SELECT value FROM settings WHERE key='integration:pix.mp.accessToken'"
        )
        .get()
        .value.includes(value),
      false
    );
    assert.throws(() => write({ 'jwt.secret': 'invalid' }));
  } finally {
    db.prepare("DELETE FROM settings WHERE key LIKE 'integration:%'").run();
    if (previous === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = previous;
  }
});
test('Token de fornecedor só é válido no portal e vincula provedor', () => {
  const h = hashPassword('Supplier-fixture-123');
  const p = db.prepare('SELECT id FROM providers LIMIT 1').get();
  db.prepare(
    'INSERT INTO supplier_portal(provider_id,portal_user,portal_password_hash,portal_salt,enabled) VALUES(?,?,?,?,1)'
  ).run(p.id, 'fixture-' + crypto.randomUUID(), h.hash, h.salt);
  const row = db
    .prepare('SELECT * FROM supplier_portal WHERE provider_id=?')
    .get(p.id);
  const { signSupplier, requireSupplier } = require('../supplier-auth');
  const token = signSupplier(row);
  assert.equal(require('../auth').verifyToken(token), null);
  let called = false;
  requireSupplier(
    { headers: { authorization: 'Bearer ' + token } },
    {
      status() {
        throw new Error('unexpected failure');
      },
    },
    () => {
      called = true;
    }
  );
  assert.equal(called, true);
  db.prepare('UPDATE supplier_portal SET enabled=0 WHERE provider_id=?').run(
    p.id
  );
  let status;
  requireSupplier(
    { headers: { authorization: 'Bearer ' + token } },
    {
      status(code) {
        status = code;
        return this;
      },
      json() {},
    },
    () => assert.fail()
  );
  assert.equal(status, 401);
});
