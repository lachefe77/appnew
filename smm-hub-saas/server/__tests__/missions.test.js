const test = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto'),
  express = require('express');
const { db, hashPassword } = require('../db');
test('Missão considera somente entregas no período, deduz estorno e paga uma vez', async () => {
  const h = hashPassword('Mission-test-12345');
  const uid = db
    .prepare(
      "INSERT INTO users(uuid,name,email,password_hash,salt,api_key) VALUES(?,'Mission',?,?,?,?)"
    )
    .run(
      crypto.randomUUID(),
      crypto.randomUUID() + '@test.invalid',
      h.hash,
      h.salt,
      crypto.randomUUID()
    ).lastInsertRowid;
  db.prepare('UPDATE users SET total_deposited_cents=1000 WHERE id=?').run(uid);
  const service = db
    .prepare('SELECT id,provider_id FROM services LIMIT 1')
    .get();
  const order = (status) => {
    const uuid = crypto.randomUUID();
    db.prepare(
      'INSERT INTO orders(uuid,user_id,service_id,provider_id,link,quantity,charge_cents,cost_cents,profit_cents,status) VALUES(?,?,?,?,?,100,1000,100,900,?)'
    ).run(
      uuid,
      uid,
      service.id,
      service.provider_id,
      'https://example.com/mission',
      status
    );
    return uuid;
  };
  order('pending');
  const complete = order('completed');
  db.prepare(
    "INSERT INTO transactions(user_id,type,amount_cents,balance_after_cents,reference_id) VALUES(?,'order_refund',200,0,?)"
  ).run(uid, complete);
  const starts = new Date(Date.now() - 60000).toISOString(),
    expires = new Date(Date.now() + 60000).toISOString();
  const id = db
    .prepare(
      "INSERT INTO weekly_missions(title,description,target_type,target_value,reward_cents,starts_at,expires_at) VALUES('Fixture','Fixture','spend_cents',800,100,?,?)"
    )
    .run(starts, expires).lastInsertRowid;
  const router = require('../routes/missions'),
    mission = db.prepare('SELECT * FROM weekly_missions WHERE id=?').get(id);
  assert.equal(router.progressFor(uid, mission), 800);
  const app = express();
  app.use('/api/missions', router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const token = require('../auth').signToken(
    db.prepare('SELECT * FROM users WHERE id=?').get(uid)
  );
  const claim = () =>
    fetch(
      'http://127.0.0.1:' +
        server.address().port +
        '/api/missions/' +
        id +
        '/claim',
      { method: 'POST', headers: { Authorization: 'Bearer ' + token } }
    );
  try {
    assert.equal((await claim()).status, 200);
    assert.equal((await claim()).status, 409);
    assert.equal(
      db.prepare('SELECT balance_cents FROM users WHERE id=?').get(uid)
        .balance_cents,
      100
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
