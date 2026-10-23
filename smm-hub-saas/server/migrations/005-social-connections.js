function up(db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS ambassador_coupons(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id),code TEXT UNIQUE NOT NULL,discount_pct INTEGER DEFAULT 0,commission_pct REAL DEFAULT 0,uses_count INTEGER DEFAULT 0,total_commissions_cents INTEGER DEFAULT 0,status TEXT DEFAULT 'pending',created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE social_connections(user_id INTEGER NOT NULL REFERENCES users(id),platform TEXT NOT NULL,subject_id TEXT NOT NULL,username TEXT NOT NULL,token_cipher TEXT NOT NULL,expires_at TEXT NOT NULL,connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,platform));
 CREATE TABLE oauth_states(state_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),browser_hash TEXT NOT NULL,expires_at TEXT NOT NULL,used_at TEXT);
 ALTER TABLE job_queue ADD COLUMN lock_token TEXT;
 ALTER TABLE ambassador_coupons ADD COLUMN coupon_id INTEGER REFERENCES coupons(id);
 CREATE INDEX idx_commissions_due ON ambassador_order_commissions(status,settles_at);
 CREATE INDEX idx_orders_user_cursor ON orders(user_id,id DESC);
 CREATE INDEX idx_transactions_user_cursor ON transactions(user_id,id DESC);
 `);
}
module.exports = { up };
