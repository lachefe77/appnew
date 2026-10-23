const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  crypto = require('node:crypto');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'smm-e2e-'));
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  PORT: process.env.E2E_PORT || '4179',
  HOST: '127.0.0.1',
  APP_PUBLIC_URL: 'http://127.0.0.1:'+(process.env.E2E_PORT||'4179'),
  DB_PATH: path.join(temp, 'data.sqlite'),
  JWT_SECRET: crypto.randomBytes(48).toString('hex'),
  SETTINGS_ENCRYPTION_KEY: /^[0-9a-f]{64}$/i.test(
    process.env.SETTINGS_ENCRYPTION_KEY || ''
  )
    ? process.env.SETTINGS_ENCRYPTION_KEY
    : crypto.randomBytes(32).toString('hex'),
  ADMIN_EMAIL: 'admin@e2e.invalid',
  ADMIN_PASSWORD: 'E2E-password-12345',
  PIX_PROVIDER: 'disabled',
  CRYPTO_PROVIDER: 'disabled',
  MAIL_ENABLED: 'false',
  CAPTCHA_PROVIDER: 'none',
  TELEGRAM_BOT_TOKEN: '',
  INSTAGRAM_GRAPH_TOKEN: '',
  RAPIDAPI_KEY: '',
  MAINTENANCE: 'false',
});
require('../server/index');
