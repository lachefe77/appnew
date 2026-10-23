const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { db, hashPassword } = require('../db');
const { signToken } = require('../auth');
const { quoteOrder, placeOrder } = require('../order-domain');
const ops = require('../ops-desk');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function account(role, balance, email) {
  const password = hashPassword('Mesa-test-12345');
  const id = Number(
    db
      .prepare(
        `INSERT INTO users(uuid,name,email,password_hash,salt,role,api_key,balance_cents)
         VALUES(?,?,?,?,?,?,?,?)`
      )
      .run(
        crypto.randomUUID(),
        'Mesa',
        email || crypto.randomUUID() + '@test.invalid',
        password.hash,
        password.salt,
        role,
        crypto.randomUUID(),
        balance
      ).lastInsertRowid
  );
  return db.prepare('SELECT * FROM users WHERE id=?').get(id);
}

test('Mesa prepara cobrança e trava compra sem mexer na vitrine', async () => {
  const buyer = account('user', 100000);
  const admin = account('admin', 0);
  const ceo = account('ceo', 0);
  const service = db
    .prepare("SELECT * FROM services WHERE status='active' LIMIT 1")
    .get();
  const before = db
    .prepare(
      'SELECT method, is_enabled, label, description FROM payment_methods_config ORDER BY method'
    )
    .all();
  const integrations = db
    .prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'integration:%'")
    .get().n;
  const app = express();
  app.use(express.json());
  app.use(require('../middleware/maintenance'));
  app.use('/api/admin', require('../routes/admin-next'));
  app.use('/api/orders', require('../routes/orders'));
  const server = await listen(app);
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = (user) => ({
    Authorization: 'Bearer ' + signToken(user),
    'Content-Type': 'application/json',
  });
  const platform = db
    .prepare('SELECT id FROM platforms_config WHERE slug=?')
    .get(service.platform);
  let createdPlatform = false;
  try {
    assert.equal(
      (await fetch(base + '/api/admin/ops/readiness', { headers: headers(buyer) })).status,
      403
    );
    const draft = await fetch(base + '/api/admin/ops/gateway-drafts/boleto', {
      method: 'PUT',
      headers: headers(ceo),
      body: JSON.stringify({ provider: 'a configurar', secret: 'chave-de-rascunho' }),
    });
    assert.equal(draft.status, 200);
    const readiness = await (
      await fetch(base + '/api/admin/ops/readiness', { headers: headers(admin) })
    ).json();
    assert.equal(readiness.charging_enabled, false);
    assert.equal(readiness.drafts.boleto.secret_stored, true);
    assert.equal(readiness.drafts.boleto.charging, false);
    assert.deepEqual(
      db
        .prepare(
          'SELECT method, is_enabled, label, description FROM payment_methods_config ORDER BY method'
        )
        .all(),
      before
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'integration:%'").get().n,
      integrations
    );

    const link = 'https://instagram.com/' + crypto.randomUUID();
    const input = { service_id: service.id, quantity: service.min_quantity, link };
    const order = placeOrder(buyer.id, input);
    const found = await (
      await fetch(base + '/api/admin/orders/lookup?q=' + encodeURIComponent(link), {
        headers: headers(admin),
      })
    ).json();
    assert.equal(found.orders.some((row) => row.id === order.id), true);
    const noted = await fetch(base + '/api/admin/orders/' + order.id + '/notes', {
      method: 'POST',
      headers: headers(admin),
      body: JSON.stringify({ note: 'nota interna da mesa' }),
    });
    assert.equal(noted.status, 201);
    const buyerView = await (
      await fetch(base + '/api/orders/' + order.id, { headers: headers(buyer) })
    ).json();
    assert.equal(JSON.stringify(buyerView).includes('nota interna da mesa'), false);

    const over = await fetch(base + '/api/admin/orders/' + order.id + '/partial-refund', {
      method: 'POST',
      headers: headers(ceo),
      body: JSON.stringify({ amount_cents: order.charge_cents + 1 }),
    });
    assert.equal(over.status, 409);
    const partial = await fetch(base + '/api/admin/orders/' + order.id + '/partial-refund', {
      method: 'POST',
      headers: headers(ceo),
      body: JSON.stringify({ amount_cents: 1 }),
    });
    assert.equal(partial.status, 200);

    const exported = await fetch(base + '/api/admin/orders/export.csv', {
      headers: headers(admin),
    });
    assert.match(exported.headers.get('content-type'), /text\/csv/);
    assert.match(await exported.text(), /charge_cents/);

    if (platform)
      db.prepare('UPDATE platforms_config SET is_paused=1 WHERE id=?').run(platform.id);
    else {
      db.prepare(
        'INSERT INTO platforms_config(slug, name, is_paused) VALUES(?,?,1)'
      ).run(service.platform, service.platform);
      createdPlatform = true;
    }
    assert.throws(
      () => quoteOrder(buyer.id, input),
      /pausada/
    );

    ops.setOps('maintenance_mode', '1');
    const blocked = { statusCode: 0, next: false };
    require('../middleware/maintenance')(
      { path: '/api/orders', ip: '203.0.113.8' },
      {
        status(code) {
          blocked.statusCode = code;
          return this;
        },
        set() {
          return this;
        },
        json() {},
        type() {
          return this;
        },
        send() {},
      },
      () => {
        blocked.next = true;
      }
    );
    assert.equal(blocked.statusCode, 503);
    let passed = false;
    require('../middleware/maintenance')(
      { path: '/api/admin/ops/readiness', ip: '203.0.113.8' },
      {},
      () => {
        passed = true;
      }
    );
    assert.equal(passed, true);

    const rehearsal = await fetch(base + '/api/admin/ops/training-deposit', {
      method: 'POST',
      headers: headers(ceo),
      body: JSON.stringify({ user_id: buyer.id, amount_cents: 100 }),
    });
    assert.equal(rehearsal.status, 409);
  } finally {
    ops.setOps('maintenance_mode', '0');
    ops.setOps('duplicate_guard', '0');
    if (platform)
      db.prepare('UPDATE platforms_config SET is_paused=0 WHERE id=?').run(platform.id);
    if (createdPlatform)
      db.prepare('DELETE FROM platforms_config WHERE slug=?').run(service.platform);
    server.close();
  }
});

test('Pedido duplicado pede confirmação e a chave antiga expira', () => {
  ops.setOps('duplicate_guard', '1');
  try {
    const buyer = account('user', 100000);
    const service = db
      .prepare("SELECT * FROM services WHERE status='active' LIMIT 1")
      .get();
    const input = {
      service_id: service.id,
      quantity: service.min_quantity,
      link: 'https://instagram.com/' + crypto.randomUUID(),
    };
    placeOrder(buyer.id, input);
    assert.throws(() => quoteOrder(buyer.id, input), /ainda está aberto/);
    assert.equal(
      quoteOrder(buyer.id, { ...input, confirm_duplicate: true }).charge_cents >
        0,
      true
    );
    const previous = buyer.api_key;
    db.prepare('UPDATE users SET api_key=? WHERE id=?').run(
      crypto.randomBytes(24).toString('hex'),
      buyer.id
    );
    db.prepare(
      "INSERT INTO api_key_grace(user_id, api_key, until) VALUES(?,?,datetime('now','+2 hours'))"
    ).run(buyer.id, previous);
    assert.equal(ops.userByApiKey(previous).id, buyer.id);
    db.prepare(
      "UPDATE api_key_grace SET until=datetime('now','-1 hour') WHERE user_id=?"
    ).run(buyer.id);
    assert.equal(ops.userByApiKey(previous), null);
  } finally {
    ops.setOps('duplicate_guard', '0');
  }
});
