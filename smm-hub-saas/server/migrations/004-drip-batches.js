function up(db) {
  db.exec(`CREATE TABLE drip_batches (
    order_id INTEGER NOT NULL REFERENCES orders(id), run INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity>0), remains INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', due_at TEXT NOT NULL,
    remote_id TEXT, provider_id INTEGER, completed_at TEXT,
    PRIMARY KEY(order_id,run));
    CREATE INDEX idx_drip_due ON drip_batches(status,due_at);
    CREATE TABLE operation_alerts (
      key TEXT PRIMARY KEY, severity TEXT NOT NULL, message TEXT NOT NULL,
      opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT);
  `);
}
module.exports = { up };
