const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { db, initDB, hashPassword } = require('../db');
const { signToken, verifyToken } = require('../auth');
const { verifyCaptcha } = require('../middleware/captcha');
const config = require('../config');

test('sessão deixa de autenticar após troca da senha ou suspensão', () => {
  initDB();
  const p = hashPassword('test-password-123');
  const id = db
    .prepare(
      `INSERT INTO users (uuid,name,email,password_hash,salt,api_key,role)
    VALUES (?, 'Session fixture', ?, ?, ?, ?, 'user')`
    )
    .run(
      crypto.randomUUID(),
      crypto.randomUUID() + '@test.invalid',
      p.hash,
      p.salt,
      crypto.randomUUID()
    ).lastInsertRowid;
  try {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    const token = signToken(user);
    assert.equal(verifyToken(token).id, Number(id));
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(
      hashPassword('replacement-password').hash,
      id
    );
    assert.equal(verifyToken(token), null);
    const fresh = signToken(
      db.prepare('SELECT * FROM users WHERE id=?').get(id)
    );
    db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(id);
    assert.equal(verifyToken(fresh), null);
  } finally {
    db.prepare('DELETE FROM users WHERE id=?').run(id);
  }
});

test('CAPTCHA habilitado recusa token ausente', async () => {
  const previous = config.captcha.provider;
  config.captcha.provider = 'turnstile';
  try {
    assert.equal(await verifyCaptcha(undefined, '127.0.0.1'), false);
  } finally {
    config.captcha.provider = previous;
  }
});
