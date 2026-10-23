require('dotenv').config();

const toInt = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const toFloat = (v, d) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};
const toBool = (v, d = false) =>
  v === undefined ? d : /^(true|1|yes)$/i.test(String(v));

const config = {
  publicUrl: process.env.APP_PUBLIC_URL || '',
  env: process.env.NODE_ENV || 'development',
  port: toInt(process.env.PORT, 3000),
  logLevel: process.env.LOG_LEVEL || 'info',

  jwt: {
    secret: process.env.JWT_SECRET || null,
    expires: process.env.JWT_EXPIRES || '7d',
  },

  db: {
    driver: process.env.DB_DRIVER || 'sqlite',
    pg: {
      host: process.env.PG_HOST || 'localhost',
      port: toInt(process.env.PG_PORT, 5432),
      user: process.env.PG_USER || 'smmhub',
      password: process.env.PG_PASSWORD || '',
      database: process.env.PG_DATABASE || 'smmhub',
    },
  },

  pix: {
    provider: process.env.PIX_PROVIDER || 'disabled',
    key: process.env.PIX_KEY || 'financeiro@smmhub.com.br',
    merchantName: process.env.PIX_MERCHANT_NAME || 'SMM HUB BRASIL',
    merchantCity: process.env.PIX_MERCHANT_CITY || 'SAO PAULO',
    mp: {
      accessToken: process.env.MP_ACCESS_TOKEN || '',
      webhookSecret: process.env.MP_WEBHOOK_SECRET || '',
    },
    efi: {
      clientId: process.env.EFI_CLIENT_ID || '',
      clientSecret: process.env.EFI_CLIENT_SECRET || '',
      certPath: process.env.EFI_CERT_PATH || '',
      sandbox: toBool(process.env.EFI_SANDBOX, true),
    },
  },

  crypto: {
    provider: process.env.CRYPTO_PROVIDER || 'disabled',
    nowpayments: {
      apiKey: process.env.NOWPAYMENTS_API_KEY || '',
      ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET || '',
    },
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: toInt(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'noreply@smmhub.com.br',
    enabled: toBool(process.env.MAIL_ENABLED, false),
  },

  affiliate: {
    l1Pct: toFloat(process.env.AFFILIATE_L1_PCT, 5),
    l2Pct: toFloat(process.env.AFFILIATE_L2_PCT, 2),
    l3Pct: toFloat(process.env.AFFILIATE_L3_PCT, 1),
    l4Pct: toFloat(process.env.AFFILIATE_L4_PCT, 0.5),
    cashbackPct: toFloat(process.env.CASHBACK_PCT, 3),
    minAccountHours: toInt(process.env.AFFILIATE_MIN_ACCOUNT_HOURS, 24),
  },

  cors: {
    origins: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()),
  },

  adminSeed: {
    email: process.env.ADMIN_EMAIL || 'admin@smmhub.com',
    password: process.env.ADMIN_PASSWORD || 'admin123',
    demoEmail: process.env.DEMO_EMAIL || 'demo@smmhub.com',
    demoPassword: process.env.DEMO_PASSWORD || 'demo123',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    alertChatId: process.env.TELEGRAM_ALERT_CHAT_ID || '',
  },

  captcha: {
    provider: process.env.CAPTCHA_PROVIDER || 'none',
    hcaptchaSecret: process.env.HCAPTCHA_SECRET || '',
    hcaptchaSiteKey: process.env.HCAPTCHA_SITE_KEY || '',
    turnstileSecret: process.env.TURNSTILE_SECRET || '',
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',
  },

  queue: {
    driver:
      process.env.QUEUE_DRIVER === 'memory'
        ? 'sqlite'
        : process.env.QUEUE_DRIVER || 'sqlite',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  metrics: {
    enabled: toBool(process.env.METRICS_ENABLED, true),
    token: process.env.METRICS_TOKEN || 'change-me',
  },

  social: {
    instagramGraphToken: process.env.INSTAGRAM_GRAPH_TOKEN || '',
    rapidapiKey: process.env.RAPIDAPI_KEY || '',
  },

  maintenance: {
    enabled: toBool(process.env.MAINTENANCE, false),
    whitelist: (process.env.MAINTENANCE_WHITELIST_IPS || '127.0.0.1,::1')
      .split(',')
      .map((s) => s.trim()),
  },
};

if (config.db.driver !== 'sqlite')
  throw new Error('DB_DRIVER suportado: sqlite.');
if (!['memory', 'sqlite'].includes(config.queue.driver))
  throw new Error('QUEUE_DRIVER suportados: sqlite e memory.');
if (
  config.env === 'production' &&
  (!config.jwt.secret ||
    config.jwt.secret.length < 48 ||
    config.jwt.secret.includes('troque-isto'))
) {
  throw new Error('JWT_SECRET é obrigatório em produção.');
}
if (!config.jwt.secret) {
  config.jwt.secret = require('node:crypto').randomBytes(48).toString('hex');
  console.warn('[config] JWT_SECRET efêmero gerado.');
}
if (
  config.env === 'production' &&
  (config.adminSeed.password === 'admin123' ||
    config.adminSeed.password.length < 12)
)
  throw new Error(
    'Configure uma senha inicial de CEO exclusiva, com pelo menos 12 caracteres.'
  );

module.exports = config;
if (
  config.env === 'production' &&
  !/^[a-f0-9]{64}$/i.test(process.env.SETTINGS_ENCRYPTION_KEY || '')
)
  throw new Error(
    'SETTINGS_ENCRYPTION_KEY é obrigatória em produção e deve conter 64 caracteres hexadecimais.'
  );
if (
  config.env === 'production' &&
  config.metrics.enabled &&
  (!process.env.METRICS_TOKEN ||
    process.env.METRICS_TOKEN.length < 32 ||
    process.env.METRICS_TOKEN.startsWith('change-me'))
)
  throw new Error(
    'Configure METRICS_TOKEN exclusivo, com pelo menos 32 caracteres, ou desative as métricas.'
  );

for (const key of [
  'pix.provider',
  'pix.mp.accessToken',
  'pix.mp.webhookSecret',
  'crypto.provider',
  'crypto.nowpayments.apiKey',
  'crypto.nowpayments.ipnSecret',
  'publicUrl',
]) {
  const parts = key.split('.');
  const leaf = parts.pop();
  let target = config;
  for (const part of parts) target = target[part];
  const fallback = target[leaf];
  Object.defineProperty(target, leaf, {
    enumerable: true,
    configurable: false,
    get() {
      return require('./runtime-config').read(key, fallback);
    },
  });
}
