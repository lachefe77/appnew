const test = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { db, hashPassword } = require('../db');
const reconciliation = require('../order-reconciliation');
function fixture(status) {
  const h = hashPassword('Reconcile-test-12345');
  const user = db
    .prepare(
      "INSERT INTO users(uuid,name,email,password_hash,salt,api_key) VALUES(?,'Reconcile',?,?,?,?)"
    )
    .run(
      crypto.randomUUID(),
      crypto.randomUUID() + '@test.invalid',
      h.hash,
      h.salt,
      crypto.randomUUID()
    ).lastInsertRowid;
  const service = db
    .prepare('SELECT id,provider_id FROM services LIMIT 1')
    .get();
  const uuid = crypto.randomUUID();
  const id = db
    .prepare(
      'INSERT INTO orders(uuid,user_id,service_id,provider_id,link,quantity,remains,charge_cents,cost_cents,profit_cents,status,remote_order_id) VALUES(?,?,?,?,?,1000,1000,1000,500,500,?,?)'
    )
    .run(
      uuid,
      user,
      service.id,
      service.provider_id,
      'https://example.com/reconcile',
      status,
      'remote-' + uuid
    ).lastInsertRowid;
  return db.prepare('SELECT * FROM orders WHERE id=?').get(id);
}
test('Resposta tardia de fornecedor não sobrescreve cancelamento e valida quantidade', () => {
  const canceled = fixture('canceled');
  assert.equal(
    reconciliation.applyProviderStatus(canceled.id, canceled.remote_order_id, {
      status: 'Completed',
    }).applied,
    false
  );
  assert.equal(
    db.prepare('SELECT status FROM orders WHERE id=?').get(canceled.id).status,
    'canceled'
  );
  const active = fixture('processing');
  assert.throws(() =>
    reconciliation.applyProviderStatus(active.id, active.remote_order_id, {
      status: 'Partial',
      remains: -1,
    })
  );
  assert.equal(
    reconciliation.applyProviderStatus(active.id, 'wrong-reference', {
      status: 'Completed',
    }).applied,
    false
  );
  const partial = reconciliation.applyProviderStatus(
    active.id,
    active.remote_order_id,
    { status: 'Partial', remains: '250' }
  );
  assert.equal(partial.status, 'partial');
  assert.equal(
    db
      .prepare('SELECT status FROM job_queue WHERE id=?')
      .get('refund:' + active.id + ':250').status,
    'pending'
  );
});
test('Conciliação recupera estorno interrompido uma única vez e isola despacho incerto', async () => {
  const failed = fixture('failed'),
    uncertain = fixture('dispatching');
  db.prepare(
    "UPDATE orders SET updated_at=datetime('now','-5 minutes'),remote_order_id=NULL WHERE id=?"
  ).run(uncertain.id);
  await reconciliation.tick();
  await reconciliation.tick();
  assert.equal(
    db
      .prepare(
        "SELECT SUM(amount_cents) AS n FROM transactions WHERE reference_id=? AND type='order_refund'"
      )
      .get(failed.uuid).n,
    1000
  );
  assert.equal(
    db.prepare('SELECT status FROM orders WHERE id=?').get(uncertain.id).status,
    'awaiting_confirmation'
  );
  assert.equal(
    db
      .prepare('SELECT remote_order_id FROM orders WHERE id=?')
      .get(uncertain.id).remote_order_id,
    null
  );
});
test('Conclusão posterior a estorno integral não concede cashback sobre valor devolvido', async () => {
  const order = fixture('completed');
  require('../smm-engine').refundOrder(order.id);
  await require('../smm-engine').handleOrderCompleted(order.id);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM transactions WHERE reference_id=? AND type='cashback'"
      )
      .get(order.uuid).n,
    0
  );
});
test('Estornos anteriores ao cashback não são descontados novamente na reversão', async () => {
  const order = fixture('completed'),
    engine = require('../smm-engine');
  engine.refundOrder(order.id, true, 200);
  await engine.handleOrderCompleted(order.id);
  assert.equal(
    db
      .prepare(
        "SELECT SUM(amount_cents) AS n FROM transactions WHERE reference_id=? AND type='cashback'"
      )
      .get(order.uuid).n,
    24
  );
  engine.refundOrder(order.id, true, 400);
  assert.equal(
    db.prepare('SELECT balance_cents FROM users WHERE id=?').get(order.user_id)
      .balance_cents,
    418
  );
  engine.refundOrder(order.id);
  assert.equal(
    db.prepare('SELECT balance_cents FROM users WHERE id=?').get(order.user_id)
      .balance_cents,
    1000
  );
});
