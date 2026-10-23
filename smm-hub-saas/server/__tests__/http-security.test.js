const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { db, initDB, hashPassword } = require('../db');
const { signToken } = require('../auth');
const { escapeHtml } = require('../html');

test('HTTP: isolamento, revogação global e atomicidade de compra', async () => {
  initDB();
  require('../extended-schema').applyExtendedSchema();
  require('../extended-schema-v3').applyV3Schema();
  const fixture = (role) => {
    const p = hashPassword('Regression-password-123');
    const id = db
      .prepare(
        `INSERT INTO users(uuid,name,email,password_hash,salt,role,api_key,balance_cents)
      VALUES(?,?,?,?,?,?,?,10000)`
      )
      .run(
        crypto.randomUUID(),
        'Fixture',
        crypto.randomUUID() + '@test.invalid',
        p.hash,
        p.salt,
        role,
        crypto.randomUUID()
      ).lastInsertRowid;
    return db.prepare('SELECT * FROM users WHERE id=?').get(id);
  };
  const a = fixture('user'),
    b = fixture('user'),
    admin = fixture('admin');
  const at = signToken(a),
    bt = signToken(b),
    staff = signToken(admin);
  const app = express();
  app.use(express.json());
  app.use('/b2b', require('../routes/b2b'));
  app.use('/profile', require('../routes/profile'));
  app.use('/v2', require('../routes/api-v2'));
  app.use('/panels', require('../routes/child-panels'));
  app.use((err, req, res, next) =>
    res.status(500).json({ error: 'Internal error' })
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(url, token, body) {
    const r = await fetch(base + url, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(3000),
    });
    return { status: r.status, body: await r.json() };
  }
  try {
    assert.equal(
      (await fetch(base + '/profile?token=' + encodeURIComponent(at))).status,
      401,
      'Token em URL não autentica'
    );
    assert.equal(
      (await request('/profile', at)).status,
      200,
      'Cabeçalho mantém autenticação'
    );
    assert.equal(
      (
        await fetch(
          base + '/v2?key=' + encodeURIComponent(a.api_key) + '&action=balance'
        )
      ).status,
      405
    );
    const initialBalance = db
      .prepare('SELECT balance_cents FROM users WHERE id=?')
      .get(a.id).balance_cents;
    const domain = crypto.randomUUID() + '.example.com';
    const panel = await request('/panels', at, {
      domain,
      panel_name: 'Fixture',
      admin_user: 'owner@example.com',
      currency: 'BRL',
    });
    assert.equal(panel.status, 201);
    assert.equal(panel.body.status, 'pending_provisioning');
    assert.equal(panel.body.charged_cents, 0);
    assert.equal(
      db.prepare('SELECT balance_cents FROM users WHERE id=?').get(a.id)
        .balance_cents,
      initialBalance
    );
    assert.equal(
      (
        await request('/panels', bt, {
          domain,
          panel_name: 'Duplicate',
          admin_user: 'owner@example.com',
        })
      ).status,
      400
    );
    assert.equal(
      (
        await request('/panels', at, {
          domain: '<img src=x>',
          panel_name: 'Fixture',
          admin_user: 'owner@example.com',
        })
      ).status,
      400
    );
    const approval = await request('/b2b/approvals', at, {
      order_payload: { fixture: true },
      amount_cents: 100,
    });
    assert.equal(approval.status, 201);
    const id = approval.body.id;
    assert.equal(
      (await request('/b2b/approvals/pending', bt)).body.approvals.some(
        (x) => x.id === id
      ),
      false
    );
    assert.equal(
      (
        await request('/b2b/approvals/' + id + '/decide', bt, {
          decision: 'approved',
        })
      ).status,
      403
    );
    assert.equal(
      (
        await request('/b2b/approvals/' + id + '/decide', staff, {
          decision: 'approved',
        })
      ).status,
      200
    );
    assert.equal(
      (
        await request('/b2b/approvals/' + id + '/decide', staff, {
          decision: 'denied',
        })
      ).status,
      409
    );
    const second = signToken(b);
    assert.equal(
      (await request('/profile/sessions/revoke-all', bt, {})).status,
      200
    );
    assert.equal((await request('/profile', second)).status, 401);
    const svc = db
      .prepare("SELECT * FROM services WHERE status='active' LIMIT 1")
      .get();
    const data = {
      key: a.api_key,
      action: 'add',
      service: svc.id,
      quantity: svc.min_quantity,
      link: { bad: true },
    };
    const balance = () =>
      db.prepare('SELECT balance_cents FROM users WHERE id=?').get(a.id)
        .balance_cents;
    const before = balance();
    assert.equal((await request('/v2', at, data)).status, 400);
    assert.equal(balance(), before);
    db.exec(
      `CREATE TEMP TRIGGER regression_insert_order BEFORE INSERT ON orders BEGIN SELECT RAISE(ABORT, 'fixture insertion failure'); END`
    );
    try {
      assert.equal(
        (
          await request('/v2', at, {
            ...data,
            link: 'https://instagram.com/fixture',
          })
        ).status,
        500
      );
    } finally {
      db.exec('DROP TRIGGER regression_insert_order');
    }
    assert.equal(balance(), before, 'Falha no INSERT deve reverter débito');
    const success = await request('/v2', at, {
      ...data,
      link: 'https://instagram.com/fixture',
    });
    assert.equal(success.status, 200);
    const order = db
      .prepare('SELECT * FROM orders WHERE id=?')
      .get(success.body.order);
    assert.equal(balance(), before - order.charge_cents);
    assert.equal(
      db
        .prepare('SELECT COUNT(*) AS n FROM transactions WHERE reference_id=?')
        .get(order.uuid).n,
      1
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Escape de HTML preserva texto sem eventos ou atributos ativos', () => {
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
  );
  assert.equal(escapeHtml("'&"), '&#39;&amp;');
});
