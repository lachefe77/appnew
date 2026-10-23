const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const migrations = ['001-runtime-invariants.js', '002-mail-ownership.js','003-combo-purchases.js','004-drip-batches.js','005-social-connections.js','006-child-ownership.js'];
function apply(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  );
  for (const filename of migrations) {
    const file = path.join(__dirname, 'migrations', filename),
      checksum = crypto
        .createHash('sha256')
        .update(fs.readFileSync(file))
        .digest('hex');
    const existing = db
      .prepare('SELECT checksum FROM schema_migrations WHERE version=?')
      .get(filename);
    if (existing) {
      if (existing.checksum !== checksum)
        throw new Error('Migração aplicada foi alterada: ' + filename);
      continue;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      require(file).up(db);
      db.prepare(
        'INSERT INTO schema_migrations(version,checksum) VALUES(?,?)'
      ).run(filename, checksum);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
module.exports = { apply };
