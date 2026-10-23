const test = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto'),
  express = require('express');
const { db, hashPassword } = require('../db');
const { signToken, verifyToken } = require('../auth');
function fixture() {
  const h = hashPassword('Identity-test-12345');
  const id = db
    .prepare(
      "INSERT INTO users(uuid,name,email,password_hash,salt,api_key,role) VALUES(?,'Identity',?,?,?,?,'user')"
    )
    .run(
      crypto.randomUUID(),
      crypto.randomUUID() + '@test.invalid',
      h.hash,
      h.salt,
      crypto.randomUUID()
    ).lastInsertRowid;
  return db.prepare('SELECT * FROM users WHERE id=?').get(id);
}
async function server() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/verify', require('../routes/email-verification'));
  const s = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  return {
    s,
    request: async (url, body, token) => {
      const r = await fetch('http://127.0.0.1:' + s.address().port + url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: JSON.stringify(body),
      });
      return { status: r.status, data: await r.json() };
    },
  };
}
test('Recuperação por token com hash é única e invalida sessões e chave API', async () => {
  const u = fixture(),
    jwt = signToken(u),
    token = crypto.randomBytes(24).toString('hex');
  db.prepare(
    'INSERT INTO password_resets(token,user_id,expires_at) VALUES(?,?,?)'
  ).run(
    crypto.createHash('sha256').update(token).digest('hex'),
    u.id,
    new Date(Date.now() + 60000).toISOString()
  );
  const { s, request } = await server();
  try {
    assert.equal(
      (
        await request('/api/auth/password-reset/confirm', {
          token,
          new_password: 'Replacement-test-12345',
        })
      ).status,
      200
    );
    assert.equal(verifyToken(jwt), null);
    assert.notEqual(
      db.prepare('SELECT api_key FROM users WHERE id=?').get(u.id).api_key,
      u.api_key
    );
    assert.equal(
      (
        await request('/api/auth/password-reset/confirm', {
          token,
          new_password: 'Another-test-12345',
        })
      ).status,
      400
    );
  } finally {
    await new Promise((r) => s.close(r));
  }
});
test('2FA mantém segredo criptografado e aceita recuperação uma única vez', async () => {
  const old = process.env.SETTINGS_ENCRYPTION_KEY;
  process.env.SETTINGS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  const u = fixture(),
    jwt = signToken(u);
  const { s, request } = await server();
  try {
    const setup = await request(
      '/api/auth/2fa/setup',
      { current_password: 'Identity-test-12345' },
      jwt
    );
    assert.equal(setup.status, 200);
    assert.notEqual(
      db.prepare('SELECT two_factor_secret FROM users WHERE id=?').get(u.id)
        .two_factor_secret,
      setup.data.secret
    );
    const code = require('speakeasy').totp({
      secret: setup.data.secret,
      encoding: 'base32',
    });
    const enabled = await request('/api/auth/2fa/enable', { code }, jwt);
    assert.equal(enabled.status, 200);
    assert.equal(enabled.data.recovery_codes.length, 10);
    const body = {
      email: u.email,
      password: 'Identity-test-12345',
      totp_code: enabled.data.recovery_codes[0],
    };
    assert.equal((await request('/api/auth/login', body)).status, 200);
    assert.equal((await request('/api/auth/login', body)).status, 401);
  } finally {
    await new Promise((r) => s.close(r));
    if (old === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = old;
  }
});
test('Confirmação de e-mail exige token válido e não permite reutilização', async () => {
  const u = fixture(),
    token = crypto.randomBytes(32).toString('hex');
  db.prepare(
    "INSERT INTO identity_tokens(token_hash,user_id,kind,expires_at) VALUES(?,?,'email',?)"
  ).run(
    crypto.createHash('sha256').update(token).digest('hex'),
    u.id,
    new Date(Date.now() + 60000).toISOString()
  );
  const { s, request } = await server();
  try {
    assert.equal((await request('/api/verify/confirm', { token })).status, 200);
    assert.equal(
      db.prepare('SELECT email_verified FROM users WHERE id=?').get(u.id)
        .email_verified,
      1
    );
    assert.equal((await request('/api/verify/confirm', { token })).status, 400);
  } finally {
    await new Promise((r) => s.close(r));
  }
});

test('TOTP consome etapa atomicamente e rejeita repetição', () => {
  const u = fixture(),
    factor = require('../factor-secret'),
    secret = require('speakeasy').generateSecret().base32;
  const code = require('speakeasy').totp({ secret, encoding: 'base32' });
  assert.equal(factor.consumeTotp(u.id, secret, code), true);
  assert.equal(factor.consumeTotp(u.id, secret, code), false);
  assert.equal(factor.consumeTotp(u.id, secret, 'invalid'), false);
});

test('Administração em produção exige sessão validada com segundo fator', async () => {
  const u = fixture(),
    config = require('../config'),
    before = config.env;
  db.prepare(
    "UPDATE users SET role='admin',two_factor_enabled=1 WHERE id=?"
  ).run(u.id);
  const admin = db.prepare('SELECT * FROM users WHERE id=?').get(u.id);
  const app = express();
  app.get('/admin', require('../auth').requireAdmin, (req, res) =>
    res.json({ ok: true })
  );
  const s = await new Promise((r) => {
    const listener = app.listen(0, '127.0.0.1', () => r(listener));
  });
  try {
    config.env = 'production';
    const url = 'http://127.0.0.1:' + s.address().port + '/admin';
    assert.equal(
      (
        await fetch(url, {
          headers: { Authorization: 'Bearer ' + signToken(admin) },
        })
      ).status,
      403
    );
    assert.equal(
      (
        await fetch(url, {
          headers: {
            Authorization:
              'Bearer ' + signToken(admin, { factorVerified: true }),
          },
        })
      ).status,
      200
    );
  } finally {
    config.env = before;
    await new Promise((r) => s.close(r));
  }
});
