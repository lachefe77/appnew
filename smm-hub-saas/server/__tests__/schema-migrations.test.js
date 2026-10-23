const test = require('node:test'),
  assert = require('node:assert/strict');
const { db } = require('../db');
test('Migrações versionadas são idempotentes e recusam checksum divergente', () => {
  const migration = require('../schema-migrations');
  migration.apply(db);
  const count = db
    .prepare('SELECT COUNT(*) AS n FROM schema_migrations')
    .get().n;
  migration.apply(db);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n,
    count
  );
  const row = db.prepare('SELECT * FROM schema_migrations LIMIT 1').get();
  db.prepare('UPDATE schema_migrations SET checksum=? WHERE version=?').run(
    'fixture-corruption',
    row.version
  );
  try {
    assert.throws(() => migration.apply(db), /foi alterada/);
  } finally {
    db.prepare('UPDATE schema_migrations SET checksum=? WHERE version=?').run(
      row.checksum,
      row.version
    );
  }
});
