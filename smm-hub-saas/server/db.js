const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data.sqlite');
if (dbPath !== ':memory:')
  require('node:fs').mkdirSync(path.dirname(path.resolve(dbPath)), {
    recursive: true,
  });
const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA busy_timeout = 5000;');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const verifyHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(
    Buffer.from(hash, 'hex'),
    Buffer.from(verifyHash, 'hex')
  );
}

function generateRefCode() {
  return 'REF' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function calculateTier(totalDepositedCents) {
  const brl = totalDepositedCents / 100;
  if (brl >= 5000) return { name: 'VIP', discount_pct: 15 };
  if (brl >= 1500) return { name: 'Gold', discount_pct: 10 };
  if (brl >= 500) return { name: 'Silver', discount_pct: 6 };
  if (brl >= 200) return { name: 'Bronze', discount_pct: 3 };
  return { name: 'Standard', discount_pct: 0 };
}

/**
 * Débito atômico de saldo. Retorna o novo saldo ou null se insuficiente.
 * NÃO precisa estar dentro de outra transação — faz UPDATE condicional.
 */
function debitBalanceAtomic(userId, amountCents) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return null;
  const result = db
    .prepare(
      `
    UPDATE users
    SET balance_cents = balance_cents - ?
    WHERE id = ? AND balance_cents >= ?
  `
    )
    .run(amountCents, userId, amountCents);

  if (result.changes === 0) return null;
  const row = db
    .prepare('SELECT balance_cents FROM users WHERE id = ?')
    .get(userId);
  return row.balance_cents;
}

/**
 * Crédito atômico de saldo. Retorna o novo saldo.
 */
function creditBalanceAtomic(userId, amountCents) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return null;
  const updated = db
    .prepare(
      'UPDATE users SET balance_cents = balance_cents + ? WHERE id = ? AND balance_cents <= ?'
    )
    .run(amountCents, userId, Number.MAX_SAFE_INTEGER - amountCents);
  if (!updated.changes) return null;
  const row = db
    .prepare('SELECT balance_cents FROM users WHERE id = ?')
    .get(userId);
  return row.balance_cents;
}

/**
 * Recálculo de tier após ajuste em total_deposited_cents.
 */
function recalcTier(userId) {
  const u = db
    .prepare('SELECT total_deposited_cents FROM users WHERE id = ?')
    .get(userId);
  if (!u) return null;
  const tier = calculateTier(u.total_deposited_cents || 0);
  db.prepare('UPDATE users SET tier = ? WHERE id = ?').run(tier.name, userId);
  return tier;
}

/**
 * Wrapper transacional seguro (node:sqlite não tem .transaction()).
 */
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    if (result && typeof result.then === 'function')
      throw new Error('Transações SQLite exigem callback síncrono.');
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    throw err;
  }
}

function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      balance_cents INTEGER NOT NULL DEFAULT 0,
      total_deposited_cents INTEGER NOT NULL DEFAULT 0,
      tier TEXT NOT NULL DEFAULT 'Standard',
      role TEXT NOT NULL DEFAULT 'user',
      api_key TEXT UNIQUE NOT NULL,
      ref_code TEXT UNIQUE,
      referred_by INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      api_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      currency TEXT DEFAULT 'USD',
      exchange_rate REAL DEFAULT 5.60,
      balance_upstream REAL DEFAULT 0,
      is_mock INTEGER DEFAULT 1,
      status TEXT DEFAULT 'active',
      last_ping_ms INTEGER,
      last_checked_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      platform TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER REFERENCES categories(id),
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'default',
      provider_id INTEGER REFERENCES providers(id),
      provider_service_id TEXT NOT NULL,
      backup_provider_id INTEGER REFERENCES providers(id),
      backup_service_id TEXT,
      cost_per_k_cents INTEGER NOT NULL,
      price_per_k_cents INTEGER NOT NULL,
      min_quantity INTEGER NOT NULL DEFAULT 10,
      max_quantity INTEGER NOT NULL DEFAULT 100000,
      refill_available INTEGER DEFAULT 1,
      cancel_available INTEGER DEFAULT 0,
      dripfeed_available INTEGER DEFAULT 1,
      avg_time TEXT DEFAULT '5 a 30 minutos',
      description TEXT,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      service_id INTEGER NOT NULL REFERENCES services(id),
      provider_id INTEGER REFERENCES providers(id),
      remote_order_id TEXT,
      link TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      charge_cents INTEGER NOT NULL,
      cost_cents INTEGER NOT NULL,
      profit_cents INTEGER NOT NULL,
      start_count INTEGER DEFAULT 0,
      remains INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      comments_payload TEXT,
      is_dripfeed INTEGER DEFAULT 0,
      dripfeed_runs INTEGER DEFAULT 1,
      dripfeed_interval INTEGER DEFAULT 0,
      dripfeed_completed_runs INTEGER DEFAULT 0,
      failover_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      service_id INTEGER NOT NULL REFERENCES services(id),
      username TEXT NOT NULL,
      posts_limit INTEGER NOT NULL DEFAULT 10,
      posts_delivered INTEGER NOT NULL DEFAULT 0,
      min_quantity INTEGER NOT NULL,
      max_quantity INTEGER NOT NULL,
      delay_minutes INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      last_checked_post_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_daily_spins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      prize_cents INTEGER NOT NULL,
      spun_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      discount_pct INTEGER DEFAULT 0,
      fixed_cents INTEGER DEFAULT 0,
      min_order_cents INTEGER DEFAULT 0,
      max_uses INTEGER DEFAULT 1000,
      uses_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      expires_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS coupon_uses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coupon_id INTEGER NOT NULL REFERENCES coupons(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      order_id INTEGER REFERENCES orders(id),
      discount_cents INTEGER NOT NULL,
      used_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS child_panels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      domain TEXT NOT NULL,
      panel_name TEXT NOT NULL,
      currency TEXT DEFAULT 'BRL',
      admin_user TEXT NOT NULL,
      price_monthly_cents INTEGER DEFAULT 4990,
      renews_at DATETIME,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS crypto_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      txid TEXT UNIQUE NOT NULL,
      external_id TEXT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      currency TEXT NOT NULL,
      amount_crypto REAL NOT NULL,
      amount_brl_cents INTEGER NOT NULL,
      wallet_address TEXT NOT NULL,
      qr_code_data_url TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS order_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS service_favorites (
      user_id INTEGER NOT NULL REFERENCES users(id),
      service_id INTEGER NOT NULL REFERENCES services(id),
      PRIMARY KEY (user_id, service_id)
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      badge TEXT DEFAULT 'NOVIDADE',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      ip_address TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      balance_after_cents INTEGER NOT NULL,
      reference_id TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pix_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      txid TEXT UNIQUE NOT NULL,
      external_id TEXT,
      provider TEXT DEFAULT 'mock',
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount_cents INTEGER NOT NULL,
      bonus_cents INTEGER DEFAULT 0,
      qr_code_data_url TEXT NOT NULL,
      copy_paste TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME,
      expires_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS referral_commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id INTEGER NOT NULL REFERENCES users(id),
      referred_id INTEGER NOT NULL REFERENCES users(id),
      level INTEGER DEFAULT 1,
      deposit_amount_cents INTEGER NOT NULL,
      commission_cents INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      order_id INTEGER REFERENCES orders(id),
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'medium',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ticket_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      is_staff INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fast_checkouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT UNIQUE NOT NULL,
      service_id INTEGER NOT NULL REFERENCES services(id),
      link TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      buyer_name TEXT NOT NULL,
      buyer_email TEXT NOT NULL,
      buyer_whatsapp TEXT NOT NULL,
      txid TEXT UNIQUE NOT NULL,
      qr_code_data_url TEXT NOT NULL,
      copy_paste TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      order_id INTEGER REFERENCES orders(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS social_proof_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT NOT NULL,
      city TEXT NOT NULL,
      service_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      time_ago TEXT NOT NULL,
      is_synthetic INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sub_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      can_order INTEGER DEFAULT 1,
      can_view_balance INTEGER DEFAULT 0,
      can_view_history INTEGER DEFAULT 1,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS client_webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT 'order.completed,order.canceled,order.partial',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      webhook_id INTEGER NOT NULL REFERENCES client_webhooks(id),
      event TEXT NOT NULL,
      payload TEXT NOT NULL,
      attempt INTEGER DEFAULT 0,
      response_status INTEGER,
      next_retry_at DATETIME,
      delivered_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS weekly_missions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_value INTEGER NOT NULL,
      reward_cents INTEGER NOT NULL,
      starts_at DATETIME NOT NULL,
      expires_at DATETIME NOT NULL,
      badge TEXT DEFAULT 'MISSÃO'
    );

    CREATE TABLE IF NOT EXISTS user_missions (
      user_id INTEGER NOT NULL REFERENCES users(id),
      mission_id INTEGER NOT NULL REFERENCES weekly_missions(id),
      current_value INTEGER DEFAULT 0,
      is_completed INTEGER DEFAULT 0,
      is_claimed INTEGER DEFAULT 0,
      claimed_at DATETIME,
      PRIMARY KEY (user_id, mission_id)
    );

    CREATE TABLE IF NOT EXISTS blog_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      meta_description TEXT NOT NULL,
      content TEXT NOT NULL,
      author TEXT DEFAULT 'Equipe SMM Hub',
      read_time_minutes INTEGER DEFAULT 4,
      category TEXT DEFAULT 'Estratégias de Crescimento',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lootbox_rolls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      cost_cents INTEGER NOT NULL,
      prize_cents INTEGER NOT NULL,
      prize_label TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_badges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      badge_code TEXT NOT NULL,
      badge_name TEXT NOT NULL,
      icon TEXT NOT NULL,
      unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, badge_code)
    );

    CREATE TABLE IF NOT EXISTS system_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER,
      action TEXT NOT NULL,
      target TEXT,
      ip TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at DATETIME NOT NULL,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS token_blacklist (
      jti TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_tx_user_created ON transactions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_services_platform ON services(platform, status);
    CREATE INDEX IF NOT EXISTS idx_services_category ON services(category_id);
    CREATE INDEX IF NOT EXISTS idx_proof_created ON social_proof_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pix_user_status ON pix_invoices(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_webhook_retry ON webhook_deliveries(delivered_at, next_retry_at);
  `);

  applySchemaMigrations();
  seedInitialData();
  if (config.env === 'production') {
    const accounts = db
      .prepare(
        "SELECT email,password_hash,salt FROM users WHERE status='active' AND (role IN ('admin','ceo') OR email=?)"
      )
      .all(config.adminSeed.demoEmail);
    for (const account of accounts)
      if (
        ['admin123', 'demo123'].some((password) =>
          verifyPassword(password, account.password_hash, account.salt)
        )
      )
        throw new Error(
          'Conta com senha de demonstração ativa. Altere a credencial antes da publicação.'
        );
  }

  // Mega-catálogo é carregado automaticamente na primeira execução
  const svcCount = db.prepare('SELECT COUNT(*) as c FROM services').get().c;
  if (svcCount === 0 && config.env !== 'production') {
    try {
      const { seedMegaCatalog } = require('./seed-mega-catalog');
      seedMegaCatalog({ silent: false });
    } catch (err) {
      console.error('[DB] Falha ao carregar mega-catálogo:', err.message);
    }
  }
}

function applySchemaMigrations() {
  const cryptoColumns = db
    .prepare('PRAGMA table_info(crypto_invoices)')
    .all()
    .map((column) => column.name);
  if (!cryptoColumns.includes('amount_crypto_text'))
    db.exec('ALTER TABLE crypto_invoices ADD COLUMN amount_crypto_text TEXT');
  if (!cryptoColumns.includes('merchant_order_id'))
    db.exec('ALTER TABLE crypto_invoices ADD COLUMN merchant_order_id TEXT');
  db.exec(
    'CREATE TABLE IF NOT EXISTS worker_leases (name TEXT PRIMARY KEY,owner TEXT NOT NULL,expires_at INTEGER NOT NULL)'
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS order_refills (id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL REFERENCES orders(id),status TEXT NOT NULL DEFAULT 'requested',remote_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);CREATE UNIQUE INDEX IF NOT EXISTS idx_active_refill ON order_refills(order_id) WHERE status IN ('requested','processing','awaiting_confirmation')"
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS ambassador_order_commissions (order_id INTEGER PRIMARY KEY REFERENCES orders(id),ambassador_id INTEGER NOT NULL REFERENCES ambassador_coupons(id),amount_cents INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',settles_at TEXT NOT NULL,paid_at TEXT)"
  );
  db.exec(
    'CREATE TABLE IF NOT EXISTS factor_recovery (user_id INTEGER NOT NULL REFERENCES users(id),code_hash TEXT NOT NULL,used_at TEXT,PRIMARY KEY(user_id,code_hash))'
  );
  db.exec(
    'CREATE TABLE IF NOT EXISTS factor_steps (user_id INTEGER PRIMARY KEY REFERENCES users(id),last_step INTEGER NOT NULL)'
  );
  db.exec(
    'CREATE TABLE IF NOT EXISTS sessions (jti TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,device TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,expires_at TEXT NOT NULL,revoked_at TEXT);CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id,expires_at)'
  );
  db.exec(
    'CREATE TABLE IF NOT EXISTS identity_tokens (token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),kind TEXT NOT NULL,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)'
  );
  db.exec(
    'CREATE TABLE IF NOT EXISTS anonymous_attribution (id INTEGER PRIMARY KEY AUTOINCREMENT,visitor_id TEXT NOT NULL,source TEXT,medium TEXT,campaign TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)'
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS job_queue (id TEXT PRIMARY KEY,name TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_run TEXT NOT NULL,locked_at TEXT,completed_at TEXT,last_error TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);CREATE INDEX IF NOT EXISTS idx_jobs_ready ON job_queue(status,next_run)"
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS order_effects (order_id INTEGER NOT NULL REFERENCES orders(id), effect TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(order_id,effect))`
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS automation_runs (kind TEXT NOT NULL,config_id INTEGER NOT NULL,period TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(kind,config_id,period));CREATE TABLE IF NOT EXISTS automation_orders (kind TEXT NOT NULL,config_id INTEGER NOT NULL,order_id INTEGER UNIQUE NOT NULL REFERENCES orders(id),period TEXT NOT NULL)`
  );
  db.exec(
    'CREATE TABLE IF NOT EXISTS order_events (id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL REFERENCES orders(id),event_type TEXT NOT NULL,payload_json TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)'
  );
  db.exec(
    `CREATE TRIGGER IF NOT EXISTS order_status_event AFTER UPDATE OF status ON orders WHEN OLD.status != NEW.status BEGIN INSERT INTO order_events(order_id,event_type,payload_json) VALUES(NEW.id,'status.'||NEW.status,NULL); END`
  );
  const sessionColumns = db
    .prepare('PRAGMA table_info(users)')
    .all()
    .map((c) => c.name);
  if (!sessionColumns.includes('session_version'))
    db.exec(
      'ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0'
    );
  if (!sessionColumns.includes('api_key_rotated_at'))
    db.exec('ALTER TABLE users ADD COLUMN api_key_rotated_at TEXT');
  db.exec(`CREATE TRIGGER IF NOT EXISTS users_balance_insert BEFORE INSERT ON users WHEN typeof(NEW.balance_cents)!='integer' OR NEW.balance_cents<0 BEGIN SELECT RAISE(ABORT,'invalid balance'); END;
    CREATE TRIGGER IF NOT EXISTS users_balance_update BEFORE UPDATE OF balance_cents ON users WHEN typeof(NEW.balance_cents)!='integer' OR NEW.balance_cents<0 OR NEW.balance_cents>9007199254740991 BEGIN SELECT RAISE(ABORT,'invalid balance'); END;
    CREATE TRIGGER IF NOT EXISTS orders_money_insert BEFORE INSERT ON orders WHEN typeof(NEW.quantity)!='integer' OR NEW.quantity<=0 OR typeof(NEW.charge_cents)!='integer' OR NEW.charge_cents<=0 OR NEW.cost_cents<0 BEGIN SELECT RAISE(ABORT,'invalid order'); END;
    CREATE TRIGGER IF NOT EXISTS review_unique_insert BEFORE INSERT ON order_reviews WHEN EXISTS(SELECT 1 FROM order_reviews WHERE order_id=NEW.order_id AND user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'review already exists'); END;
    CREATE TRIGGER IF NOT EXISTS transaction_unique_insert BEFORE INSERT ON transactions WHEN NEW.reference_id IS NOT NULL AND NEW.type IN ('deposit_pix','deposit_crypto','cashback','order_debit') AND EXISTS(SELECT 1 FROM transactions WHERE type=NEW.type AND reference_id=NEW.reference_id) BEGIN SELECT RAISE(ABORT,'transaction already exists'); END;`);
  const pixColumns = db
    .prepare('PRAGMA table_info(pix_invoices)')
    .all()
    .map((c) => c.name);
  if (!pixColumns.includes('bonus_cents')) {
    db.exec(
      'ALTER TABLE pix_invoices ADD COLUMN bonus_cents INTEGER DEFAULT 0;'
    );
  }
  if (!pixColumns.includes('external_id')) {
    db.exec('ALTER TABLE pix_invoices ADD COLUMN external_id TEXT;');
  }
  if (!pixColumns.includes('provider')) {
    db.exec(
      "ALTER TABLE pix_invoices ADD COLUMN provider TEXT DEFAULT 'mock';"
    );
  }
  if (!pixColumns.includes('expires_at')) {
    db.exec('ALTER TABLE pix_invoices ADD COLUMN expires_at DATETIME;');
  }

  const userColumns = db
    .prepare('PRAGMA table_info(users)')
    .all()
    .map((c) => c.name);
  for (const [col, ddl] of [
    [
      'cashback_cents',
      'ALTER TABLE users ADD COLUMN cashback_cents INTEGER DEFAULT 0;',
    ],
    ['whatsapp', 'ALTER TABLE users ADD COLUMN whatsapp TEXT;'],
    [
      'two_factor_secret',
      'ALTER TABLE users ADD COLUMN two_factor_secret TEXT;',
    ],
    [
      'two_factor_enabled',
      'ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER DEFAULT 0;',
    ],
    [
      'email_verified',
      'ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0;',
    ],
  ]) {
    if (!userColumns.includes(col)) db.exec(ddl);
  }

  // Migração de cargos legados → nova hierarquia (ceo/admin/support/vip/user)
  db.exec("UPDATE users SET role = 'user' WHERE role = 'usuario'");
  db.exec(
    "UPDATE users SET role = 'support' WHERE role IN ('suporte', 'finance', 'provider_manager')"
  );
  // Promove o admin seed original pra CEO se ainda não houver CEO
  const hasCEO =
    db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'ceo'").get().c >
    0;
  if (!hasCEO) {
    const seedAdmin = db
      .prepare("SELECT id FROM users WHERE email = ? AND role = 'admin'")
      .get(config.adminSeed.email);
    const target =
      seedAdmin ||
      db
        .prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC")
        .get();
    if (target)
      db.prepare("UPDATE users SET role = 'ceo' WHERE id = ?").run(target.id);
  }

  const subCols = db
    .prepare('PRAGMA table_info(subscriptions)')
    .all()
    .map((c) => c.name);
  if (!subCols.includes('last_checked_post_id')) {
    db.exec('ALTER TABLE subscriptions ADD COLUMN last_checked_post_id TEXT;');
  }

  const provCols = db
    .prepare('PRAGMA table_info(providers)')
    .all()
    .map((c) => c.name);
  if (!provCols.includes('last_ping_ms')) {
    db.exec('ALTER TABLE providers ADD COLUMN last_ping_ms INTEGER;');
    db.exec('ALTER TABLE providers ADD COLUMN last_checked_at DATETIME;');
  }

  const cpCols = db
    .prepare('PRAGMA table_info(child_panels)')
    .all()
    .map((c) => c.name);
  if (!cpCols.includes('renews_at')) {
    db.exec('ALTER TABLE child_panels ADD COLUMN renews_at DATETIME;');
  }

  const rcCols = db
    .prepare('PRAGMA table_info(referral_commissions)')
    .all()
    .map((c) => c.name);
  if (!rcCols.includes('level')) {
    db.exec(
      'ALTER TABLE referral_commissions ADD COLUMN level INTEGER DEFAULT 1;'
    );
  }

  // Cupons iniciais
  const couponCount = db
    .prepare('SELECT COUNT(*) as count FROM coupons')
    .get().count;
  if (couponCount === 0) {
    db.prepare(
      'INSERT INTO coupons (code, discount_pct, min_order_cents) VALUES (?, ?, ?)'
    ).run('BEMVINDO10', 10, 1000);
    db.prepare(
      'INSERT INTO coupons (code, fixed_cents, min_order_cents) VALUES (?, ?, ?)'
    ).run('PRIMEIRACOMPRA', 500, 2000);
    db.prepare(
      'INSERT INTO coupons (code, discount_pct, min_order_cents) VALUES (?, ?, ?)'
    ).run('VIPBLACK', 20, 5000);
  }

  const annCount = db
    .prepare('SELECT COUNT(*) as count FROM announcements')
    .get().count;
  if (annCount === 0 && config.env !== 'production') {
    db.prepare(
      `
      INSERT INTO announcements (title, message, badge)
      VALUES ('🚀 Servidores de TikTok e Instagram Atualizados!', 'A entrega de visualizações de Reels e TikTok FYP agora conta com início em menos de 60 segundos e reposição automática ativa.', 'HOT')
    `
    ).run();
  }

  const spCount = db
    .prepare('SELECT COUNT(*) as count FROM social_proof_events')
    .get().count;
  if (spCount === 0 && config.env !== 'production') {
    const proofs = [
      [
        'Lucas M.',
        'São Paulo - SP',
        'Seguidores Brasileiros Reais',
        'instagram',
        2500,
        'há 2 minutos',
      ],
      [
        'Juliana F.',
        'Rio de Janeiro - RJ',
        'Visualizações FYP TikTok',
        'tiktok',
        10000,
        'há 4 minutos',
      ],
      [
        'Agência Nexus',
        'Belo Horizonte - MG',
        'Pacote 4.000 Horas Monetização',
        'youtube',
        4000,
        'há 7 minutos',
      ],
      [
        'Rodrigo B.',
        'Curitiba - PR',
        'Curtidas Brasileiras Instantâneas',
        'instagram',
        1500,
        'há 11 minutos',
      ],
      [
        'Matheus K.',
        'Florianópolis - SC',
        'Membros para Grupo Telegram',
        'telegram',
        500,
        'há 15 minutos',
      ],
    ];
    for (const [name, city, sname, plat, qty, timeAgo] of proofs) {
      db.prepare(
        `
        INSERT INTO social_proof_events (user_name, city, service_name, platform, quantity, time_ago, is_synthetic)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `
      ).run(name, city, sname, plat, qty, timeAgo);
    }
  }

  const missionCount = db
    .prepare('SELECT COUNT(*) as count FROM weekly_missions')
    .get().count;
  if (missionCount === 0) {
    const now = new Date().toISOString();
    const nextWeek = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    db.prepare(
      `
      INSERT INTO weekly_missions (title, description, target_type, target_value, reward_cents, starts_at, expires_at, badge)
      VALUES
      ('Turbinador Semanal', 'Gaste R$ 80,00 em pedidos nesta semana', 'spend_cents', 8000, 1000, ?, ?, 'POPULAR'),
      ('Explorador Multi-Redes', 'Faça pelo menos 5 pedidos de qualquer serviço', 'orders_count', 5, 500, ?, ?, 'FÁCIL'),
      ('Reviewer Oficial', 'Avalie com 5 estrelas 3 pedidos concluídos', 'reviews_count', 3, 300, ?, ?, 'BÔNUS')
    `
    ).run(now, nextWeek, now, nextWeek, now, nextWeek);
  }

  const blogCount = db
    .prepare('SELECT COUNT(*) as count FROM blog_posts')
    .get().count;
  if (blogCount === 0 && config.env !== 'production') {
    db.prepare(
      `
      INSERT INTO blog_posts (slug, title, meta_description, content, category, read_time_minutes)
      VALUES
      ('como-comprar-seguidores-instagram-seguro-2026', 'Como Comprar Seguidores no Instagram com Segurança em 2026', 'Guia definitivo para acelerar a prova social do seu perfil sem risco de bloqueio pelo algoritmo.', 'O algoritmo do Instagram avalia velocidade e retenção de perfil. Ao adquirir seguidores de alta qualidade com entrega gradual (Drip-Feed), sua conta ganha tração imediata sem disparar gatilhos de segurança...', 'Instagram Growth', 5),
      ('estrategia-fyp-tiktok-visualizacoes-retencao', 'Segredos do Algoritmo FYP no TikTok: Retenção e Curtidas Rápidas', 'Descubra como os maiores criadores aceleram vídeos para o For You com empurrão inicial nas primeiras 2 horas.', 'A janela crítica de distribuição do TikTok ocorre nas primeiras 2 horas após a postagem...', 'TikTok Viral', 4),
      ('como-monetizar-canal-youtube-4000-horas', 'Passo a Passo: Como Bater as 4.000 Horas no YouTube Rapidamente', 'Entenda como creators utilizam pacotes de retenção alta para liberar o Programa de Parcerias do YouTube.', 'O requisito de 4.000 horas assistidas nos últimos 365 dias é o maior gargalo para criadores iniciantes...', 'YouTube Monetização', 6)
    `
    ).run();
  }

  // Settings padrão
  const upsertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  upsertSetting.run('freeze_mode', '0');
  upsertSetting.run('affiliate_l1_pct', String(config.affiliate.l1Pct));
  upsertSetting.run('affiliate_l2_pct', String(config.affiliate.l2Pct));
  upsertSetting.run('cashback_pct', String(config.affiliate.cashbackPct));
  upsertSetting.run('current_usd_brl', '5.60');
  upsertSetting.run('min_deposit_brl', '5');
  upsertSetting.run('allow_synthetic_proof', '0');
  require('./schema-migrations').apply(db);
}

function seedInitialData() {
  const userCount = db
    .prepare('SELECT COUNT(*) as count FROM users')
    .get().count;
  if (userCount === 0) {
    const adminPass = hashPassword(config.adminSeed.password);
    db.prepare(
      `
      INSERT INTO users (uuid, name, email, password_hash, salt, balance_cents, role, api_key, ref_code, tier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'VIP')
    `
    ).run(
      crypto.randomUUID(),
      'CEO SMM Hub',
      config.adminSeed.email,
      adminPass.hash,
      adminPass.salt,
      config.env === 'production' ? 0 : 100000,
      'ceo',
      'smm_' + crypto.randomBytes(16).toString('hex'),
      'REFCEO0001'
    );

    if (config.env !== 'production') {
      const demoPass = hashPassword(config.adminSeed.demoPassword);
      db.prepare(
        `
      INSERT INTO users (uuid, name, email, password_hash, salt, balance_cents, role, api_key, ref_code, tier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Silver')
    `
      ).run(
        crypto.randomUUID(),
        'Cliente Demo VIP',
        config.adminSeed.demoEmail,
        demoPass.hash,
        demoPass.salt,
        15000,
        'user',
        'smm_' + crypto.randomBytes(16).toString('hex'),
        'REFDEMO77'
      );
    }
  }

  if(config.env==='production'){
    if(process.env.UPSTREAM_HUB_URL&&process.env.UPSTREAM_HUB_API_KEY&&!db.prepare('SELECT id FROM providers LIMIT 1').get()){
      const origin=new URL(process.env.UPSTREAM_HUB_URL);
      if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash)throw Error('UPSTREAM_HUB_URL deve ser HTTPS.');
      db.prepare("INSERT INTO providers(name,api_url,api_key,currency,exchange_rate,is_mock) VALUES('Painel principal',?,?,'BRL',1,0)").run(origin.href,require('./factor-secret').seal(process.env.UPSTREAM_HUB_API_KEY));
    }
    return;
  }
  const provCount = db
    .prepare('SELECT COUNT(*) as count FROM providers')
    .get().count;
  if (provCount === 0) {
    db.prepare(
      `
      INSERT INTO providers (name, api_url, api_key, currency, exchange_rate, balance_upstream, is_mock)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      'Provedor Primário (Mock)',
      'https://example.invalid/api/v2',
      'mock_key_01',
      'USD',
      5.6,
      482.5,
      1
    );

    db.prepare(
      `
      INSERT INTO providers (name, api_url, api_key, currency, exchange_rate, balance_upstream, is_mock)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      'Provedor Backup (Mock)',
      'https://example.invalid/api/v2',
      'mock_key_02',
      'USD',
      5.6,
      215.1,
      1
    );
  }
}

function close() {
  try {
    db.close();
  } catch (e) {}
}

module.exports = {
  migrateExistingSchema: applySchemaMigrations,
  db,
  initDB,
  close,
  hashPassword,
  verifyPassword,
  generateRefCode,
  calculateTier,
  debitBalanceAtomic,
  creditBalanceAtomic,
  recalcTier,
  tx,
};
