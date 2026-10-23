const { db } = require('./db');

const defaults = {
  duplicate_guard: '0',
  maintenance_mode: '0',
  training_deposits: '0',
  new_account_hours: '0',
  new_account_spend_cap_cents: '0',
  provider_balance_floor: '0',
  api_key_grace_hours: '24',
  checklist_vps: '{}',
};

let ready = false;

function applySchema() {
  if (ready) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ops_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gateway_drafts (
      method TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      secret_cipher TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS webhook_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      external_id TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      payload TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS order_staff_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      admin_id INTEGER,
      note TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS order_retry_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      admin_id INTEGER,
      outcome TEXT NOT NULL,
      detail TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS provider_balance_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id INTEGER NOT NULL,
      balance TEXT,
      currency TEXT,
      ok INTEGER NOT NULL DEFAULT 1,
      detail TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS markup_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id INTEGER,
      platform TEXT,
      snapshot_json TEXT NOT NULL,
      restored_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS canned_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS mass_order_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      message TEXT NOT NULL,
      excerpt TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS subscription_run_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER,
      message TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS api_key_grace (
      user_id INTEGER PRIMARY KEY,
      api_key TEXT NOT NULL,
      until TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS backup_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      location TEXT NOT NULL,
      last_export_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const platforms = db.prepare('PRAGMA table_info(platforms_config)').all();
  if (!platforms.length) return;
  if (!platforms.some((column) => column.name === 'is_paused'))
    db.exec(
      'ALTER TABLE platforms_config ADD COLUMN is_paused INTEGER NOT NULL DEFAULT 0'
    );
  const tickets = db.prepare('PRAGMA table_info(tickets)').all();
  if (
    tickets.length &&
    !tickets.some((column) => column.name === 'assignee_id')
  )
    db.exec('ALTER TABLE tickets ADD COLUMN assignee_id INTEGER');
  const seed = db.prepare(
    'INSERT OR IGNORE INTO ops_settings(key, value) VALUES(?, ?)'
  );
  for (const [key, value] of Object.entries(defaults)) seed.run(key, value);
  ready = true;
}

function ops(key, fallback = '0') {
  try {
    applySchema();
    return (
      db.prepare('SELECT value FROM ops_settings WHERE key=?').get(key)?.value ??
      fallback
    );
  } catch {
    return fallback;
  }
}

function setOps(key, value) {
  applySchema();
  db.prepare(
    'INSERT INTO ops_settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).run(key, value);
}

function assertCommerceGuards(user, service, input, charge) {
  applySchema();
  try {
    const paused = db
      .prepare(
        'SELECT is_paused FROM platforms_config WHERE is_paused=1 AND (slug=? OR lower(name)=lower(?)) LIMIT 1'
      )
      .get(service.platform, service.platform);
    if (paused)
      throw Object.assign(
        new Error('Esta plataforma está pausada para compras novas.'),
        { status: 503 }
      );
  } catch (error) {
    if (error.status) throw error;
  }
  if (ops('duplicate_guard') === '1' && input.confirm_duplicate !== true) {
    const duplicate = db
      .prepare(
        `SELECT id FROM orders WHERE user_id=? AND service_id=? AND link=? AND quantity=?
         AND status IN ('pending','processing','in_progress')
         AND datetime(created_at)>datetime('now','-10 minutes')
         ORDER BY id DESC LIMIT 1`
      )
      .get(user.id, service.id, input.link, Number(input.quantity));
    if (duplicate)
      throw Object.assign(
        new Error(
          'Pedido igual ao #' +
            duplicate.id +
            ' ainda está aberto. Envie confirm_duplicate para repetir.'
        ),
        { status: 409 }
      );
  }
  const hours = Number(ops('new_account_hours'));
  const cap = Number(ops('new_account_spend_cap_cents'));
  if (
    Number.isInteger(hours) &&
    hours > 0 &&
    Number.isInteger(cap) &&
    cap > 0
  ) {
    const young = db
      .prepare(
        "SELECT 1 AS n FROM users WHERE id=? AND (julianday('now')-julianday(created_at))*24 < ?"
      )
      .get(user.id, hours);
    if (young) {
      const spent = db
        .prepare(
          "SELECT COALESCE(SUM(charge_cents),0) AS n FROM orders WHERE user_id=? AND status!='canceled'"
        )
        .get(user.id).n;
      if (spent + charge > cap)
        throw Object.assign(
          new Error('Conta nova atingiu o limite temporário de compra.'),
          { status: 429 }
        );
    }
  }
}

function snapshotMarkup(providerId, platform) {
  applySchema();
  let query =
    "SELECT id, price_per_k_cents FROM services WHERE status='active'";
  const params = [];
  if (providerId) {
    query += ' AND provider_id=?';
    params.push(providerId);
  }
  if (platform) {
    query += ' AND platform=?';
    params.push(platform);
  }
  const rows = db.prepare(query).all(...params);
  db.prepare(
    'INSERT INTO markup_snapshots(provider_id, platform, snapshot_json) VALUES(?,?,?)'
  ).run(providerId || null, platform || null, JSON.stringify(rows));
}

function logRetry(orderId, adminId, outcome, detail) {
  try {
    applySchema();
    db.prepare(
      'INSERT INTO order_retry_log(order_id, admin_id, outcome, detail) VALUES(?,?,?,?)'
    ).run(orderId, adminId || null, String(outcome).slice(0, 40), String(detail || '').slice(0, 300));
  } catch {}
}

function logProviderBalance(providerId, balance, currency, ok, detail) {
  try {
    applySchema();
    db.prepare(
      'INSERT INTO provider_balance_log(provider_id, balance, currency, ok, detail) VALUES(?,?,?,?,?)'
    ).run(
      providerId,
      balance == null ? null : String(balance).slice(0, 40),
      currency ? String(currency).slice(0, 12) : null,
      ok ? 1 : 0,
      detail ? String(detail).slice(0, 300) : null
    );
    const floor = Number(ops('provider_balance_floor'));
    const numeric = Number(balance);
    if (floor > 0 && Number.isFinite(numeric) && numeric < floor) {
      db.prepare(
        `INSERT INTO operation_alerts(key, severity, message) VALUES('provider-floor','warning',?)
         ON CONFLICT(key) DO UPDATE SET message=excluded.message, severity='warning', updated_at=CURRENT_TIMESTAMP, resolved_at=NULL`
      ).run('Saldo upstream abaixo do piso configurado.');
    }
  } catch {}
}

function logMassError(userId, message, excerpt) {
  try {
    applySchema();
    db.prepare(
      'INSERT INTO mass_order_errors(user_id, message, excerpt) VALUES(?,?,?)'
    ).run(userId, String(message || 'Falha no lote.').slice(0, 300), String(excerpt || '').slice(0, 500));
  } catch {}
}

function logSubscription(subscriptionId, message) {
  try {
    applySchema();
    db.prepare(
      'INSERT INTO subscription_run_log(subscription_id, message) VALUES(?,?)'
    ).run(subscriptionId, String(message || 'Falha na assinatura.').slice(0, 300));
  } catch {}
}

function logWebhook(source, externalId, status, payload) {
  try {
    applySchema();
    db.prepare(
      'INSERT INTO webhook_inbox(source, external_id, status, payload) VALUES(?,?,?,?)'
    ).run(
      String(source).slice(0, 40),
      String(externalId || '').slice(0, 120),
      String(status).slice(0, 40),
      String(payload || '').slice(0, 1500)
    );
  } catch {}
}

function userByApiKey(key) {
  const direct = db
    .prepare('SELECT id, balance_cents, status FROM users WHERE api_key = ?')
    .get(key);
  if (direct) return direct;
  try {
    applySchema();
    const grace = db
      .prepare(
        "SELECT user_id FROM api_key_grace WHERE api_key=? AND datetime(until)>datetime('now')"
      )
      .get(key);
    if (!grace) return null;
    return db
      .prepare('SELECT id, balance_cents, status FROM users WHERE id=?')
      .get(grace.user_id);
  } catch {
    return null;
  }
}

function maintenanceEnabled() {
  return ops('maintenance_mode', '0') === '1';
}

module.exports = {
  applySchema,
  ops,
  setOps,
  assertCommerceGuards,
  snapshotMarkup,
  logRetry,
  logProviderBalance,
  logMassError,
  logSubscription,
  logWebhook,
  userByApiKey,
  maintenanceEnabled,
};
