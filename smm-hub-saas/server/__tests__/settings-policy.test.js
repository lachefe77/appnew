const test = require('node:test'),
  assert = require('node:assert/strict');
const { validateSettings } = require('../settings-policy');
test('Configurações financeiras recusam percentuais e tipos inválidos', () => {
  assert.deepEqual(validateSettings({ cashback_pct: '3', freeze_mode: '0' }), {
    cashback_pct: '3',
    freeze_mode: '0',
  });
  for (const payload of [
    { cashback_pct: 'abc' },
    { cashback_pct: 21 },
    { affiliate_l1_pct: -10 },
    { 'integration:pix.mp.accessToken': 'secret' },
    { allow_synthetic_proof: 1 },
    { freeze_mode: 0.5 },
    { min_deposit_brl: '' },
    [],
  ])
    assert.throws(() => validateSettings(payload));
});
test('Cliente de provedor rejeita destinos internos e cifra chaves', async () => {
  const { providerFetch, sealKey } = require('../provider-client');
  await assert.rejects(
    providerFetch('https://127.0.0.1/', { body: 'key=fixture' }),
    /Internet pública/
  );
  const before = process.env.SETTINGS_ENCRYPTION_KEY;
  process.env.SETTINGS_ENCRYPTION_KEY = require('node:crypto')
    .randomBytes(32)
    .toString('hex');
  try {
    const sealed = sealKey('provider-fixture');
    assert.notEqual(sealed, 'provider-fixture');
    assert.equal(require('../factor-secret').open(sealed), 'provider-fixture');
  } finally {
    if (before === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = before;
  }
});
