const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { db, hashPassword } = require('../db');
const { signToken } = require('../auth');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('Oferta pública omite gateway desligado e CNPJ placeholder', async () => {
  const app = express();
  app.use('/api/site', require('../routes/site-config'));
  const server = await listen(app);
  try {
    const response = await fetch(
      'http://127.0.0.1:' + server.address().port + '/api/site/offer'
    );
    assert.equal(response.status, 200);
    const offer = await response.json();
    assert.equal(offer.company.cnpj, null);
    assert.equal(offer.instagram_connect, false);
    assert.ok(Array.isArray(offer.payments));
    assert.equal(
      offer.payments.some((method) =>
        ['boleto', 'credit_card', 'pix', 'bitcoin', 'usdt'].includes(method.method) &&
        ['boleto', 'credit_card'].includes(method.method)
      ),
      false
    );
    assert.equal(offer.payments.length, 0);
  } finally {
    server.close();
  }
});

test('Admin cria catálogo, blog, desafio e encerra fila LGPD', async () => {
  const password = hashPassword('Catalog-test-12345');
  const adminId = Number(
    db
      .prepare(
        `INSERT INTO users(uuid,name,email,password_hash,salt,role,api_key,balance_cents)
         VALUES(?,?,?,?,?,'admin',?,0)`
      )
      .run(
        crypto.randomUUID(),
        'Catalog Admin',
        crypto.randomUUID() + '@test.invalid',
        password.hash,
        password.salt,
        crypto.randomUUID()
      ).lastInsertRowid
  );
  const admin = db.prepare('SELECT * FROM users WHERE id=?').get(adminId);
  const userId = Number(
    db
      .prepare(
        `INSERT INTO users(uuid,name,email,password_hash,salt,role,api_key,balance_cents)
         VALUES(?,?,?,?,?,'user',?,0)`
      )
      .run(
        crypto.randomUUID(),
        'Catalog User',
        crypto.randomUUID() + '@test.invalid',
        password.hash,
        password.salt,
        crypto.randomUUID()
      ).lastInsertRowid
  );
  const app = express();
  app.use(express.json());
  app.use('/api/admin', require('../routes/admin-catalog'));
  const server = await listen(app);
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + signToken(admin),
  };
  async function send(path, body, method = 'POST') {
    const response = await fetch(base + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json();
    assert.equal(response.status < 300, true, path + ' ' + JSON.stringify(payload));
    return payload;
  }
  try {
    const category = await send('/api/admin/categories', {
      name: 'Categoria teste',
      platform: 'instagram',
    });
    const provider = db
      .prepare("SELECT id FROM providers WHERE status='active' LIMIT 1")
      .get();
    const service = await send('/api/admin/services', {
      name: 'Serviço manual teste',
      platform: 'instagram',
      provider_service_id: 'manual-1',
      category_id: category.id,
      provider_id: provider.id,
      cost_per_k_cents: 100,
      price_per_k_cents: 300,
      min_quantity: 10,
      max_quantity: 1000,
      refill_available: 1,
      status: 'active',
    });
    assert.ok(service.id);
    const post = await send('/api/admin/blog', {
      title: 'Post de operação',
      content: 'Texto longo o bastante para publicar no blog interno.',
    });
    assert.ok(post.id);
    const challenge = await send('/api/admin/challenges', {
      title: 'Desafio do mês',
      target_type: 'orders_count',
      target_value: 3,
      prize_pool_cents: 500,
      month: '2026-10',
    });
    await send('/api/admin/challenges/' + challenge.id + '/close');
    const scheduledId = Number(
      db
        .prepare(
          `INSERT INTO scheduled_orders(user_id, service_id, link, quantity, run_at, status)
           VALUES(?,?,?,?,?,'pending')`
        )
        .run(userId, service.id, 'https://example.com/post', 20, '2030-01-01T00:00:00.000Z')
        .lastInsertRowid
    );
    const listed = await fetch(base + '/api/admin/scheduled', { headers });
    const rows = await listed.json();
    assert.equal(listed.status, 200);
    assert.ok(rows.rows.some((row) => row.id === scheduledId && row.user_email));
    await send('/api/admin/scheduled/' + scheduledId + '/cancel');
    const requestId = Number(
      db
        .prepare("INSERT INTO lgpd_requests(user_id, type, status) VALUES(?, 'export', 'pending')")
        .run(userId).lastInsertRowid
    );
    await send('/api/admin/lgpd/requests/' + requestId + '/status', {
      status: 'rejected',
      note: 'Faltou documento',
    });
    const saved = db.prepare('SELECT status, note FROM lgpd_requests WHERE id=?').get(requestId);
    assert.equal(saved.status, 'rejected');
    assert.equal(saved.note, 'Faltou documento');
    const summary = await fetch(base + '/api/admin/affiliates/summary', { headers });
    const totals = await summary.json();
    assert.equal(summary.status, 200);
    assert.equal(typeof totals.entries, 'number');
    assert.ok(totals.rates);
  } finally {
    server.close();
  }
});
