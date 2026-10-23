function up(db) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS combo_purchases(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),combo_id INTEGER NOT NULL REFERENCES combos(id),request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,order_ids_json TEXT NOT NULL,charge_cents INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,request_id));`,
  );
}
module.exports = { up };
