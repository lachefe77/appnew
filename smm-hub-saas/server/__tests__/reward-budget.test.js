const test = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { db, hashPassword, tx } = require('../db');
test('Bônus acumulados não geram crédito ilimitado após depósito único', () => {
  const h = hashPassword('Reward-test-12345');
  const id = db
    .prepare(
      "INSERT INTO users(uuid,name,email,password_hash,salt,api_key,total_deposited_cents) VALUES(?,'Reward',?,?,?,?,500)"
    )
    .run(
      crypto.randomUUID(),
      crypto.randomUUID() + '@test.invalid',
      h.hash,
      h.salt,
      crypto.randomUUID()
    ).lastInsertRowid;
  const budget = require('../reward-budget');
  assert.equal(budget.remaining(id), 50);
  assert.throws(() => budget.requireBudget(id, 100));
  tx(() => {
    budget.requireBudget(id, 50);
    db.prepare(
      "INSERT INTO transactions(user_id,type,amount_cents,balance_after_cents) VALUES(?,'daily_spin_bonus',50,50)"
    ).run(id);
  });
  assert.equal(budget.remaining(id), 0);
  assert.throws(() => budget.requireBudget(id, 1));
  db.prepare('UPDATE users SET total_deposited_cents=1500 WHERE id=?').run(id);
  assert.equal(budget.remaining(id), 100);
});
