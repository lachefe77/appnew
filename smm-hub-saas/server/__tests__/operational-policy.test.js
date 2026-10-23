const test = require('node:test'),
  assert = require('node:assert/strict');
const { db } = require('../db');
test('Manutenção mantém recebimento de webhooks e responde JSON para APIs', () => {
  const config = require('../config'),
    previous = config.maintenance.enabled;
  config.maintenance.enabled = true;
  const middleware = require('../middleware/maintenance');
  try {
    for (const path of [
      '/health/live',
      '/health/ready',
      '/api/wallet/pix/webhook',
      '/api/wallet/crypto/webhook',
    ]) {
      let passed = false;
      middleware({ ip: '203.0.113.10', path }, {}, () => {
        passed = true;
      });
      assert.equal(passed, true);
    }
    let status, body;
    const response = {
      status(value) {
        status = value;
        return this;
      },
      set() {
        return this;
      },
      json(value) {
        body = value;
      },
    };
    middleware({ ip: '203.0.113.10', path: '/api/orders' }, response, () =>
      assert.fail()
    );
    assert.equal(status, 503);
    assert.equal(typeof body.error, 'string');
  } finally {
    config.maintenance.enabled = previous;
  }
});
test('Congelamento bloqueia novas cobranças e preserva confirmação e leitura', () => {
  const previous = db
    .prepare("SELECT value FROM settings WHERE key='freeze_mode'")
    .get().value;
  db.prepare("UPDATE settings SET value='1' WHERE key='freeze_mode'").run();
  const middleware = require('../middleware/freeze');
  try {
    for (const path of [
      '/api/wallet/pix/create',
      '/api/wallet/crypto/create',
      '/api/gamification/spin',
      '/api/missions/1/claim',
      '/api/fast-checkout/init',
    ]) {
      let status;
      middleware(
        { method: 'POST', originalUrl: path },
        {
          status(value) {
            status = value;
            return this;
          },
          json() {},
        },
        () => assert.fail()
      );
      assert.equal(status, 503);
    }
    for (const [method, path] of [
      ['POST', '/api/wallet/pix/webhook'],
      ['POST', '/api/wallet/crypto/webhook'],
      ['GET', '/api/orders'],
      ['POST', '/api/auth/logout'],
    ]) {
      let passed = false;
      middleware({ method, originalUrl: path }, {}, () => {
        passed = true;
      });
      assert.equal(passed, true);
    }
  } finally {
    db.prepare("UPDATE settings SET value=? WHERE key='freeze_mode'").run(
      previous
    );
  }
});
