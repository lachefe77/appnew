const test = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { db, hashPassword } = require('../db');
const { signToken } = require('../auth');
const { isPublicAddress, resolveWebhook } = require('../webhook-http');
const express = require('express');
test('Webhooks recusam endereços internos, DNS misto e protocolos não TLS', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    '192.168.1.1',
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  await assert.rejects(resolveWebhook('http://example.com'));
  await assert.rejects(resolveWebhook('https://127.0.0.1'));
  await assert.rejects(
    resolveWebhook('https://example.com', async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
  );
  const result = await resolveWebhook('https://example.com', async () => [
    { address: '8.8.8.8', family: 4 },
  ]);
  assert.equal(result.record.address, '8.8.8.8');
});
test('Subconta aplica permissões atuais, não recebe chave e perde sessão após remoção', async () => {
  const h = hashPassword('Sub-password-123');
  const uid = db
    .prepare(
      "INSERT INTO users(uuid,name,email,password_hash,salt,api_key,role,balance_cents) VALUES(?,?,?,?,?,?,'ceo',10000)"
    )
    .run(
      crypto.randomUUID(),
      'Parent',
      crypto.randomUUID() + '@test.invalid',
      h.hash,
      h.salt,
      crypto.randomUUID()
    ).lastInsertRowid;
  const parent = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  const email = crypto.randomUUID() + '@test.invalid';
  const sid = db
    .prepare(
      'INSERT INTO sub_accounts(parent_user_id,name,email,password_hash,salt,can_order,can_view_balance,can_view_history) VALUES(?,?,?,?,?,0,0,0)'
    )
    .run(uid, 'Member', email, h.hash, h.salt).lastInsertRowid;
  const app = express();
  app.use(express.json());
  app.use('/api/agency', require('../routes/agency'));
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/orders', require('../routes/orders'));
  app.use('/api/admin', require('../routes/admin'));
  const server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  async function req(url, token, body) {
    const r = await fetch('http://127.0.0.1:' + server.address().port + url, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(3000),
    });
    return { status: r.status, data: await r.json() };
  }
  try {
    const login = await req('/api/agency/sub-login', '', {
      email,
      password: 'Sub-password-123',
    });
    assert.equal(login.status, 200);
    const t = login.data.token;
    const me = await req('/api/auth/me', t);
    assert.equal(me.status, 200);
    assert.equal(me.data.user.role, 'user');
    assert.equal(me.data.user.api_key, undefined);
    assert.equal(me.data.user.balance_cents, undefined);
    assert.equal((await req('/api/admin/users', t)).status, 403);
    const svc = db
      .prepare("SELECT * FROM services WHERE status='active' LIMIT 1")
      .get();
    const body = {
      service_id: svc.id,
      quantity: svc.min_quantity,
      link: 'https://instagram.com/test',
    };
    assert.equal((await req('/api/orders', t, body)).status, 403);
    db.prepare('UPDATE sub_accounts SET can_order=1 WHERE id=?').run(sid);
    assert.equal((await req('/api/orders', t, body)).status, 201);
    db.prepare('DELETE FROM sub_accounts WHERE id=?').run(sid);
    assert.equal((await req('/api/auth/me', t)).status, 401);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
test('Reembolso acumulado nunca supera cobrança e conclusão só produz um cashback', async () => {
  const h = hashPassword('Finance-password-123');
  const uid = db
    .prepare(
      "INSERT INTO users(uuid,name,email,password_hash,salt,api_key,role) VALUES(?,?,?,?,?,?,'user')"
    )
    .run(
      crypto.randomUUID(),
      'Finance',
      crypto.randomUUID() + '@test.invalid',
      h.hash,
      h.salt,
      crypto.randomUUID()
    ).lastInsertRowid;
  const svc = db
    .prepare("SELECT * FROM services WHERE status='active' LIMIT 1")
    .get();
  const uuid = crypto.randomUUID();
  const id = db
    .prepare(
      "INSERT INTO orders(uuid,user_id,service_id,provider_id,link,quantity,charge_cents,cost_cents,profit_cents,status) VALUES(?,?,?,?,?,1000,1000,500,500,'completed')"
    )
    .run(
      uuid,
      uid,
      svc.id,
      svc.provider_id,
      'https://instagram.com/test'
    ).lastInsertRowid;
  const engine = require('../smm-engine');
  await engine.handleOrderCompleted(id);
  await engine.handleOrderCompleted(id);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM transactions WHERE type='cashback' AND reference_id=?"
      )
      .get(uuid).n,
    1
  );
  engine.refundOrder(id, true, 0);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM transactions WHERE type='order_refund' AND reference_id=?"
      )
      .get(uuid).n,
    0
  );
  assert.throws(() => engine.refundOrder(id, true, -1));
  assert.throws(() => engine.refundOrder(id, true, 1001));
  engine.refundOrder(id, true, 500);
  engine.refundOrder(id, true, 500);
  engine.refundOrder(id);
  engine.refundOrder(id);
  assert.equal(
    db
      .prepare(
        "SELECT SUM(amount_cents) AS n FROM transactions WHERE type='order_refund' AND reference_id=?"
      )
      .get(uuid).n,
    1000
  );
});
