function up(db) {
  db.exec(`ALTER TABLE child_panels ADD COLUMN dns_token TEXT;
 ALTER TABLE child_panels ADD COLUMN ownership_verified_at TEXT;
 ALTER TABLE child_panels ADD COLUMN activation_secret_cipher TEXT;
 ALTER TABLE child_panels ADD COLUMN provisioned_at TEXT;
 CREATE INDEX idx_social_expiry ON social_connections(expires_at);
 ALTER TABLE order_refills ADD COLUMN batch_run INTEGER;
 ALTER TABLE order_refills ADD COLUMN provider_id INTEGER REFERENCES providers(id);
 DROP INDEX IF EXISTS idx_active_refill;
 CREATE UNIQUE INDEX idx_active_refill ON order_refills(order_id,COALESCE(batch_run,0)) WHERE status IN ('requested','processing','awaiting_confirmation');
 `);
}
module.exports = { up };
