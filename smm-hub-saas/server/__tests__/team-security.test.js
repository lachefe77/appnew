const test = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto'),
  express = require('express');
const { db, hashPassword } = require('../db');
const { signToken, verifyToken } = require('../auth');
test('Reset de equipe revoga sessões e chave comercial anteriores', async () => {
  const fixture = (role) => {
    const h = hashPassword('Team-test-12345');
    const id = db
      .prepare(
        "INSERT INTO users(uuid,name,email,password_hash,salt,api_key,role) VALUES(?,'Team',?,?,?,?,?)"
      )
      .run(
        crypto.randomUUID(),
        crypto.randomUUID() + '@test.invalid',
        h.hash,
        h.salt,
        crypto.randomUUID(),
        role
      ).lastInsertRowid;
    return db.prepare('SELECT * FROM users WHERE id=?').get(id);
  };
  const ceo = fixture('ceo'),
    member = fixture('support'),
    token = signToken(member);
  const app = express();
  app.use(express.json());
  app.use('/team', require('../routes/team'));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const response = await fetch(
      'http://127.0.0.1:' +
        server.address().port +
        '/team/' +
        member.id +
        '/reset-password',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + signToken(ceo),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ new_password: 'Replacement-team-12345' }),
      }
    );
    assert.equal(response.status, 200);
    assert.equal(verifyToken(token), null);
    assert.notEqual(
      db.prepare('SELECT api_key FROM users WHERE id=?').get(member.id).api_key,
      member.api_key
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
