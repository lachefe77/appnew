const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite'),
  { spawnSync } = require('node:child_process');
const source = path.resolve(
  process.argv[2] || path.join(__dirname, '../data.sqlite')
);
const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'smm-migration-check-')
  ),
  copy = path.join(directory, 'copy.sqlite');
function snapshot(database) {
  return {
    users: database
      .prepare(
        'SELECT COUNT(*) AS n,COALESCE(SUM(balance_cents),0) AS balances,COALESCE(SUM(total_deposited_cents),0) AS deposits FROM users'
      )
      .get(),
    orders: database
      .prepare(
        'SELECT COUNT(*) AS n,COALESCE(SUM(charge_cents),0) AS charges FROM orders'
      )
      .get(),
    transactions: database
      .prepare(
        'SELECT COUNT(*) AS n,COALESCE(SUM(amount_cents),0) AS amounts FROM transactions'
      )
      .get(),
  };
}
try {
  const original = new DatabaseSync(source, { readOnly: true });
  let before;
  try {
    before = snapshot(original);
    original.exec("VACUUM INTO '" + copy.replace(/'/g, "''") + "'");
  } finally {
    original.close();
  }
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      "require('./server/db').initDB();require('./server/extended-schema').applyExtendedSchema();require('./server/extended-schema-v3').applyV3Schema();require('./server/db').close();",
    ],
    {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DB_PATH: copy,
        LOG_LEVEL: 'silent',
        JWT_SECRET: crypto.randomBytes(48).toString('hex'),
      },
      encoding: 'utf8',
      windowsHide: true,
    }
  );
  if (result.status !== 0)
    throw new Error('Migração da cópia falhou: ' + result.stderr);
  const migrated = new DatabaseSync(copy, { readOnly: true });
  let after, integrity, foreignKeys, migrations;
  try {
    after = snapshot(migrated);
    integrity = migrated.prepare('PRAGMA quick_check').get().quick_check;
    foreignKeys = migrated.prepare('PRAGMA foreign_key_check').all();
    migrations = migrated
      .prepare(
        'SELECT version,applied_at FROM schema_migrations ORDER BY version'
      )
      .all();
  } finally {
    migrated.close();
  }
  const report = {
    date: new Date().toISOString(),
    source_read_only: source,
    scope: 'Somente cópia temporária; banco original não foi migrado.',
    before,
    after,
    financial_aggregates_preserved:
      JSON.stringify(before) === JSON.stringify(after),
    integrity,
    foreign_key_violations: foreignKeys.length,
    migrations,
    passed:
      JSON.stringify(before) === JSON.stringify(after) &&
      integrity === 'ok' &&
      foreignKeys.length === 0,
  };
  if (process.argv[3])
    fs.writeFileSync(
      path.resolve(process.argv[3]),
      JSON.stringify(report, null, 2)
    );
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  const resolved = path.resolve(directory);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolved).startsWith('smm-migration-check-')
  )
    throw new Error('Diretório temporário inválido.');
  fs.rmSync(resolved, { recursive: true, force: true });
}
