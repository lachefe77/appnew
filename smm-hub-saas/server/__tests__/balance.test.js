const test = require('node:test');
const assert = require('node:assert');
const { db, debitBalanceAtomic, creditBalanceAtomic } = require('../db');

test('débito atômico recusa saldo insuficiente', () => {
  const email = `bal-test-${Date.now()}@test.local`;
  const { hashPassword } = require('../db');
  const p = hashPassword('x');
  const r = db.prepare(`INSERT INTO users (uuid, name, email, password_hash, salt, balance_cents, role, api_key, ref_code)
    VALUES (?, 'Test', ?, ?, ?, 1000, 'user', ?, ?)`).run(require('node:crypto').randomUUID(), email, p.hash, p.salt, 'k' + Date.now(), 'R' + Date.now());

  const newBal = debitBalanceAtomic(r.lastInsertRowid, 500);
  assert.strictEqual(newBal, 500);

  const failed = debitBalanceAtomic(r.lastInsertRowid, 999999);
  assert.strictEqual(failed, null, 'deveria recusar débito maior que saldo');

  const after = creditBalanceAtomic(r.lastInsertRowid, 100);
  assert.strictEqual(after, 600);

  db.prepare('DELETE FROM users WHERE id = ?').run(r.lastInsertRowid);
});
