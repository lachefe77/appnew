const test = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto'),
  express = require('express');
const { db, hashPassword } = require('../db');
const { signToken, verifyToken } = require('../auth');
test('Remoção encerra sessões, apaga fatores e limpa mensagens pendentes da conta', async () => {
  const h = hashPassword('Privacy-test-12345');
  const id = db
    .prepare(
      "INSERT INTO users(uuid,name,email,password_hash,salt,api_key,two_factor_secret) VALUES(?,'Privacy',?,?,?,?,?)"
    )
    .run(
      crypto.randomUUID(),
      crypto.randomUUID() + '@test.invalid',
      h.hash,
      h.salt,
      crypto.randomUUID(),
      'legacy-fixture'
    ).lastInsertRowid;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(id),
    token = signToken(user);
  const job = require('../job-queue').enqueue(
    'mail',
    { encrypted: 'fixture' },
    { userId: id }
  );
  const app = express();
  app.use(express.json());
  app.use('/api/lgpd', require('../routes/lgpd'));
  app.use((error, req, res, next) =>
    res.status(error.status || 500).json({ error: error.message })
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const response = await fetch(
      'http://127.0.0.1:' + server.address().port + '/api/lgpd/delete-account',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          confirm: 'DELETAR MINHA CONTA',
          password: 'Privacy-test-12345',
        }),
      }
    );
    assert.equal(response.status, 200, await response.text());
    const deleted = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    assert.equal(deleted.status, 'deleted');
    assert.notEqual(deleted.password_hash, user.password_hash);
    assert.equal(deleted.two_factor_secret, null);
    assert.notEqual(deleted.email, user.email);
    assert.equal(verifyToken(token), null);
    assert.equal(
      db.prepare('SELECT id FROM job_queue WHERE id=?').get(job),
      undefined
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
