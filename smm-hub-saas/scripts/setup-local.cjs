const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const target = path.join(root, '.env');
if (fs.existsSync(target)) throw new Error('.env existente preservado; revise a configuração antes de iniciar.');
const secret = () => crypto.randomBytes(32).toString('hex');
const values = {
  NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '3000',
  DB_DRIVER: 'sqlite', DB_PATH: path.join(root, 'data.sqlite').replace(/\\/g, '/'),
  JWT_SECRET: secret(), SETTINGS_ENCRYPTION_KEY: secret(), METRICS_TOKEN: secret(),
  ADMIN_PASSWORD: secret(), QUEUE_DRIVER: 'sqlite',
  APP_PUBLIC_URL: 'http://127.0.0.1:3000',
  CORS_ORIGINS: 'http://127.0.0.1:3000,http://localhost:3000',
  PIX_PROVIDER: 'disabled', CRYPTO_PROVIDER: 'disabled', MAIL_ENABLED: 'false',
  CAPTCHA_PROVIDER: 'none', TRUST_PROXY: 'loopback',
};
fs.writeFileSync(target, Object.entries(values).map(([key,value]) => key + '=' + JSON.stringify(value)).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
console.log('Ambiente local criado; credenciais das contas existentes preservadas e pagamentos reais desativados.');
