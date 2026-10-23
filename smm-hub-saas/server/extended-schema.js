const { db } = require('./db');

/**
 * Tabelas adicionadas na v2.1: notes, blacklist, snapshots, LGPD, fingerprints, embaixador, i18n translations.
 * Idempotente — pode rodar sempre.
 */
function applyExtendedSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_user_id INTEGER NOT NULL REFERENCES users(id),
      admin_id INTEGER NOT NULL REFERENCES users(id),
      note TEXT NOT NULL,
      is_pinned INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS blocked_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      reason TEXT,
      added_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS financial_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_date TEXT UNIQUE NOT NULL,
      revenue_cents INTEGER NOT NULL,
      cost_cents INTEGER NOT NULL,
      profit_cents INTEGER NOT NULL,
      orders_count INTEGER NOT NULL,
      deposits_count INTEGER NOT NULL,
      deposits_cents INTEGER NOT NULL,
      users_total INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS device_fingerprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      visitor_id TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, visitor_id)
    );

    CREATE TABLE IF NOT EXISTS lgpd_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS lgpd_consent (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      consented_terms INTEGER DEFAULT 0,
      consented_marketing INTEGER DEFAULT 0,
      ip TEXT,
      consented_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ambassador_coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      code TEXT UNIQUE NOT NULL,
      discount_pct INTEGER DEFAULT 10,
      commission_pct REAL DEFAULT 10,
      uses_count INTEGER DEFAULT 0,
      total_commissions_cents INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      theme TEXT DEFAULT 'neo-shinjuku',
      language TEXT DEFAULT 'pt',
      currency TEXT DEFAULT 'BRL',
      notifications_email INTEGER DEFAULT 1,
      notifications_push INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS currencies (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      rate_from_brl REAL NOT NULL DEFAULT 1.0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS service_reviews_public (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id),
      user_name_masked TEXT NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_notes_user ON admin_notes(target_user_id);
    CREATE INDEX IF NOT EXISTS idx_blocked_pattern ON blocked_links(pattern);
    CREATE INDEX IF NOT EXISTS idx_snap_date ON financial_snapshots(snapshot_date DESC);
    CREATE INDEX IF NOT EXISTS idx_fp_visitor ON device_fingerprints(visitor_id);
    CREATE INDEX IF NOT EXISTS idx_amb_code ON ambassador_coupons(code);
  `);

  // Soft delete columns
  const uCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!uCols.includes('deleted_at')) db.exec('ALTER TABLE users ADD COLUMN deleted_at DATETIME;');

  const oCols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  if (!oCols.includes('deleted_at')) db.exec('ALTER TABLE orders ADD COLUMN deleted_at DATETIME;');

  // Seed moedas padrão
  const cCount = db.prepare('SELECT COUNT(*) as c FROM currencies').get().c;
  if (cCount === 0) {
    db.prepare('INSERT INTO currencies (code, name, symbol, rate_from_brl) VALUES (?,?,?,?)').run('BRL', 'Real', 'R$', 1.0);
    db.prepare('INSERT INTO currencies (code, name, symbol, rate_from_brl) VALUES (?,?,?,?)').run('USD', 'Dólar', '$', 0.18);
    db.prepare('INSERT INTO currencies (code, name, symbol, rate_from_brl) VALUES (?,?,?,?)').run('EUR', 'Euro', '€', 0.16);
  }
}

module.exports = { applyExtendedSchema };
