const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { db, hashPassword } = require('../db');
const { signToken } = require('../auth');
const {
  placeOrder,
  placeBatch,
  placeEach,
  quoteOrder,
} = require('../order-domain');
const { dispatchOrder, handleOrderCompleted, requestRefill } = require('../smm-engine');
const { applyProviderStatus } = require('../order-reconciliation');
const { unstable } = require('../order-notices');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function account(role, balance) {
  const password = hashPassword('Pedido-test-12345');
  const id = Number(
    db
      .prepare(
        `INSERT INTO users(uuid,name,email,password_hash,salt,role,api_key,balance_cents)
         VALUES(?,?,?,?,?,?,?,?)`
      )
      .run(
        crypto.randomUUID(),
        'Cliente',
        crypto.randomUUID() + '@test.invalid',
        password.hash,
        password.salt,
        role,
        crypto.randomUUID(),
        balance
      ).lastInsertRowid
  );
  return db.prepare('SELECT * FROM users WHERE id=?').get(id);
}
function input(service, path) {
  return {
    service_id: service.id,
    quantity: service.min_quantity,
    link: 'https://example.com/' + (path || crypto.randomUUID()),
  };
}

test('pedido do cliente passa de pendente a em andamento e concluído', async () => {
  const buyer = account('user', 500000);
  const support = account('support', 0);
  const stranger = account('user', 0);
  const service = db.prepare("SELECT * FROM services WHERE status='active' LIMIT 1").get();
  const previousCancel = service.cancel_available;
  db.prepare('UPDATE services SET cancel_available=1 WHERE id=?').run(service.id);
  const app = express();
  app.use(express.json());
  app.use('/api/orders', require('../routes/orders'));
  app.use('/api/support', require('../routes/support'));
  app.use('/api/v2', require('../routes/api-v2'));
  app.use('/api/agency', require('../routes/agency'));
  app.use('/api/services', require('../routes/services'));
  app.use('/api/subscriptions', require('../routes/subscriptions'));
  app.use('/api/dashboard', require('../routes/dashboard'));
  app.use('/api/admin', require('../routes/admin-next'));
  const server = await listen(app);
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = (user) => ({
    Authorization: 'Bearer ' + signToken(user),
    'Content-Type': 'application/json',
  });
  try {
    assert.equal(unstable(2, 2), false);
    assert.equal(unstable(5, 2), true);
    const seen = [];
    const created = placeOrder(buyer.id, input(service));
    assert.equal(
      db.prepare('SELECT status FROM orders WHERE id=?').get(created.id).status,
      'pending'
    );
    seen.push(
      (await (await fetch(base + '/api/orders/' + created.id, { headers: headers(buyer) })).json())
        .order.status
    );
    const dispatched = await dispatchOrder(created.id);
    assert.equal(dispatched.status, 'in_progress');
    const row = db.prepare('SELECT * FROM orders WHERE id=?').get(created.id);
    const middle = applyProviderStatus(created.id, row.remote_order_id, {
      status: 'in progress',
      remains: Math.max(0, row.quantity - 1),
    });
    assert.equal(middle.status, 'in_progress');
    const midView = await (
      await fetch(base + '/api/orders/' + created.id, { headers: headers(buyer) })
    ).json();
    seen.push(midView.order.status);
    assert.equal(JSON.stringify(midView).includes('cost_cents'), false);
    assert.equal(JSON.stringify(midView).includes('remote_order_id'), false);
    const finished = applyProviderStatus(created.id, row.remote_order_id, {
      status: 'completed',
    });
    assert.equal(finished.status, 'completed');
    await handleOrderCompleted(created.id);
    const doneView = await (
      await fetch(base + '/api/orders/' + created.id, { headers: headers(buyer) })
    ).json();
    seen.push(doneView.order.status);
    assert.deepEqual(seen, ['pending', 'in_progress', 'completed']);
    assert.deepEqual(
      doneView.order.notices.map((notice) => notice.status),
      ['pending', 'in_progress', 'completed']
    );
    const list = await (await fetch(base + '/api/orders', { headers: headers(buyer) })).json();
    assert.equal(list.orders.find((order) => order.id === created.id).status, 'completed');
    const home = await (await fetch(base + '/api/dashboard', { headers: headers(buyer) })).json();
    assert.ok(Array.isArray(home.attention));

    const balance = db.prepare('SELECT balance_cents FROM users WHERE id=?').get(buyer.id).balance_cents;
    const cancelable = placeOrder(buyer.id, input(service));
    const canceled = await fetch(base + '/api/orders/' + cancelable.id + '/cancel', {
      method: 'POST',
      headers: headers(buyer),
    });
    assert.equal(canceled.status, 200);
    assert.equal(
      db.prepare('SELECT status FROM orders WHERE id=?').get(cancelable.id).status,
      'canceled'
    );
    assert.equal(
      db.prepare('SELECT balance_cents FROM users WHERE id=?').get(buyer.id).balance_cents,
      balance
    );
    const moving = placeOrder(buyer.id, input(service));
    await dispatchOrder(moving.id);
    const blocked = await fetch(base + '/api/orders/' + moving.id + '/cancel', {
      method: 'POST',
      headers: headers(buyer),
    });
    assert.equal(blocked.status, 409);
    assert.equal(
      db.prepare('SELECT status FROM orders WHERE id=?').get(moving.id).status,
      'in_progress'
    );

    const good = input(service, 'lote-valido-' + crypto.randomUUID());
    const bad = { service_id: 999999, quantity: 10, link: 'https://example.com/ruim' };
    const before = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE user_id=?').get(buyer.id).n;
    assert.throws(() => placeBatch(buyer.id, [good, bad]));
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM orders WHERE user_id=?').get(buyer.id).n,
      before
    );
    const preview = await fetch(base + '/api/orders/mass/preview', {
      method: 'POST',
      headers: headers(buyer),
      body: JSON.stringify({
        raw_text: good.service_id + '|' + good.quantity + '|' + good.link + '\n999999|10|https://example.com/ruim',
      }),
    });
    const lines = await preview.json();
    assert.equal(preview.status, 200);
    assert.equal(lines.lines[0].ok, true);
    assert.equal(lines.lines[1].ok, false);
    const each = placeEach(buyer.id, [good, bad]);
    assert.equal(each.created.length, 1);
    assert.equal(each.errors.length, 1);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM orders WHERE user_id=?').get(buyer.id).n,
      before + 1
    );

    const staff = await fetch(base + '/api/support/orders/' + moving.id, {
      headers: headers(support),
    });
    const staffBody = await staff.json();
    assert.equal(staff.status, 200);
    assert.ok(staffBody.order.remote_order_id);
    assert.equal(JSON.stringify(staffBody).includes('cost_cents'), false);
    assert.equal(JSON.stringify(staffBody).includes('api_key'), false);
    assert.equal(
      (await fetch(base + '/api/support/orders/' + moving.id, { headers: headers(stranger) })).status,
      403
    );
    const noted = await fetch(base + '/api/support/orders/' + moving.id + '/notes', {
      method: 'POST',
      headers: headers(support),
      body: JSON.stringify({ note: 'cliente avisado' }),
    });
    assert.equal(noted.status, 201);
    const buyerAgain = await (
      await fetch(base + '/api/orders/' + moving.id, { headers: headers(buyer) })
    ).json();
    assert.equal(JSON.stringify(buyerAgain).includes('cliente avisado'), false);

    const apiCancel = placeOrder(buyer.id, input(service));
    const canceledApi = await fetch(base + '/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: buyer.api_key, action: 'cancel', order: apiCancel.id }),
    });
    assert.equal(canceledApi.status, 200);
    assert.equal((await canceledApi.json()).cancel, apiCancel.id);
    await requestRefill(created.id);
    const refill = db.prepare('SELECT id, status FROM order_refills WHERE order_id=?').get(created.id);
    const refillStatus = await fetch(base + '/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: buyer.api_key,
        action: 'refill_status',
        refill: refill.id,
      }),
    });
    assert.equal(refillStatus.status, 200);
    assert.equal((await refillStatus.json()).status, 'Completed');
    const mass = await fetch(base + '/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: buyer.api_key,
        action: 'mass',
        orders:
          service.id +
          '|' +
          service.min_quantity +
          '|https://example.com/api-' +
          crypto.randomUUID() +
          '\n0|1|nao-e-link',
      }),
    });
    const massBody = await mass.json();
    assert.equal(mass.status, 200);
    assert.equal(massBody.created.length, 1);
    assert.equal(massBody.errors.length, 1);

    const quote = quoteOrder(buyer.id, input(service, 'teto-' + crypto.randomUUID()));
    const password = hashPassword('Subconta-test-12345');
    const subId = Number(
      db
        .prepare(
          `INSERT INTO sub_accounts(parent_user_id,name,email,password_hash,salt,can_order,can_view_history,status,spend_cap_cents)
           VALUES(?,?,?,?,?,1,1,'active',?)`
        )
        .run(
          buyer.id,
          'Membro',
          crypto.randomUUID() + '@test.invalid',
          password.hash,
          password.salt,
          Math.max(1, quote.charge_cents - 1)
        ).lastInsertRowid
    );
    const capped = await fetch(base + '/api/orders', {
      method: 'POST',
      headers: headers({ ...buyer, sub_account_id: subId }),
      body: JSON.stringify(input(service, 'sub-' + crypto.randomUUID())),
    });
    assert.equal(capped.status, 429);
    db.prepare('UPDATE sub_accounts SET spend_cap_cents=? WHERE id=?').run(
      quote.charge_cents * 5,
      subId
    );
    const allowed = await fetch(base + '/api/orders', {
      method: 'POST',
      headers: headers({ ...buyer, sub_account_id: subId }),
      body: JSON.stringify(input(service, 'sub-ok-' + crypto.randomUUID())),
    });
    assert.equal(allowed.status, 201);
    const allowedBody = await allowed.json();
    assert.equal(
      db.prepare('SELECT placed_by_sub FROM orders WHERE id=?').get(allowedBody.order.id)
        .placed_by_sub,
      subId
    );

    const client = await fetch(base + '/api/agency/clients', {
      method: 'POST',
      headers: headers(buyer),
      body: JSON.stringify({ name: 'Cliente final', spend_cap_cents: Math.max(1, quote.charge_cents - 1) }),
    });
    assert.equal(client.status, 201);
    const clientId = (await client.json()).id;
    const overClient = await fetch(base + '/api/orders', {
      method: 'POST',
      headers: headers(buyer),
      body: JSON.stringify({ ...input(service, 'cliente-' + crypto.randomUUID()), client_id: clientId }),
    });
    assert.equal(overClient.status, 429);
    db.prepare('UPDATE agency_clients SET spend_cap_cents=? WHERE id=?').run(
      quote.charge_cents * 5,
      clientId
    );
    const underClient = await fetch(base + '/api/orders', {
      method: 'POST',
      headers: headers(buyer),
      body: JSON.stringify({ ...input(service, 'cliente-ok-' + crypto.randomUUID()), client_id: clientId }),
    });
    assert.equal(underClient.status, 201);
    const month = await (await fetch(base + '/api/agency/clients', { headers: headers(buyer) })).json();
    assert.ok(month.clients.find((item) => item.id === clientId).spent_cents >= quote.charge_cents);

    const category = db.prepare('SELECT id FROM categories LIMIT 1').get();
    const unstableId = Number(
      db
        .prepare(
          `INSERT INTO services(category_id,name,platform,provider_id,provider_service_id,cost_per_k_cents,price_per_k_cents,min_quantity,max_quantity,status)
           VALUES(?,?,?,?,?,?,?,?,?,'active')`
        )
        .run(
          category.id,
          'Serviço instável ' + crypto.randomUUID(),
          service.platform,
          service.provider_id,
          'unstable',
          100,
          200,
          10,
          1000
        ).lastInsertRowid
    );
    for (let index = 0; index < 3; index += 1)
      db.prepare(
        `INSERT INTO orders(uuid,user_id,service_id,provider_id,link,quantity,remains,charge_cents,cost_cents,profit_cents,status)
         VALUES(?,?,?,?,?,10,10,100,50,50,'failed')`
      ).run(
        crypto.randomUUID(),
        buyer.id,
        unstableId,
        service.provider_id,
        'https://example.com/falha-' + index
      );
    const catalog = await (await fetch(base + '/api/services')).json();
    const flagged = catalog.services.find((item) => item.id === unstableId);
    assert.equal(flagged.unstable, 1);
    assert.equal(catalog.services.some((item) => item.id === service.id), true);

    const subRow = Number(
      db
        .prepare(
          `INSERT INTO subscriptions(user_id,service_id,username,posts_limit,min_quantity,max_quantity,status)
           VALUES(?,?,?,10,?,?, 'active')`
        )
        .run(buyer.id, service.id, 'perfil', service.min_quantity, service.min_quantity)
        .lastInsertRowid
    );
    db.prepare('INSERT INTO subscription_run_log(subscription_id, message) VALUES(?,?)').run(
      subRow,
      'o perfil não publicou'
    );
    const subs = await (
      await fetch(base + '/api/subscriptions', { headers: headers(buyer) })
    ).json();
    assert.equal(
      subs.subscriptions.find((item) => item.id === subRow).last_message,
      'o perfil não publicou'
    );

    const admin = account('admin', 0);
    const inbox = await (await fetch(base + '/api/admin/ops/inbox', { headers: headers(admin) })).json();
    assert.ok(Array.isArray(inbox.failed_orders));
    assert.ok(Array.isArray(inbox.unassigned_tickets));
    assert.equal(inbox.provider_balance_floor, 0);
  } finally {
    db.prepare('UPDATE services SET cancel_available=? WHERE id=?').run(previousCancel, service.id);
    server.close();
  }
});
