const crypto = require('node:crypto');
const { db, tx } = require('./db');
const fields = {
  'pix.provider': {
    secret: false,
    values: ['disabled', 'mock', 'mercadopago'],
  },
  'pix.mp.accessToken': { secret: true },
  'pix.mp.webhookSecret': { secret: true },
  'crypto.provider': {
    secret: false,
    values: ['disabled', 'mock', 'nowpayments'],
  },
  'crypto.nowpayments.apiKey': { secret: true },
  'crypto.nowpayments.ipnSecret': { secret: true },
  publicUrl: { secret: false },
};
function encryptionKey() {
  const k = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!k || !/^[0-9a-f]{64}$/i.test(k))
    throw new Error(
      'Configure SETTINGS_ENCRYPTION_KEY com 32 bytes em hexadecimal.'
    );
  return Buffer.from(k, 'hex');
}
function encrypt(value) {
  const iv = crypto.randomBytes(12),
    c = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const body = Buffer.concat([c.update(value, 'utf8'), c.final()]);
  return JSON.stringify({
    iv: iv.toString('hex'),
    tag: c.getAuthTag().toString('hex'),
    body: body.toString('hex'),
  });
}
function decrypt(value) {
  const e = JSON.parse(value),
    c = crypto.createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(e.iv, 'hex')
    );
  c.setAuthTag(Buffer.from(e.tag, 'hex'));
  return Buffer.concat([
    c.update(Buffer.from(e.body, 'hex')),
    c.final(),
  ]).toString('utf8');
}
function read(key, fallback) {
  const row = db
    .prepare('SELECT value FROM settings WHERE key=?')
    .get('integration:' + key);
  if (!row) return fallback;
  return fields[key].secret ? decrypt(row.value) : row.value;
}
function write(values) {
  const entries = Object.entries(values);
  for (const [key, value] of entries) {
    if (
      !Object.hasOwn(fields, key) ||
      typeof value !== 'string' ||
      value.length > 4096
    )
      throw new Error('Campo inválido.');
    if (fields[key].values && !fields[key].values.includes(value))
      throw new Error('Provedor inválido.');
    if (key === 'publicUrl' && value) {
      const u = new URL(value);
      if (
        u.protocol !== 'https:' ||
        u.username ||
        u.password ||
        u.search ||
        u.hash ||
        u.pathname !== '/'
      )
        throw new Error('URL pública deve ser uma origem HTTPS.');
    }
  }
  return tx(() => {
    for (const [key, value] of entries) {
      if (fields[key].secret && !value) continue;
      db.prepare(
        'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
      ).run('integration:' + key, fields[key].secret ? encrypt(value) : value);
    }
  });
}
module.exports = { fields, read, write, encrypt, decrypt };
