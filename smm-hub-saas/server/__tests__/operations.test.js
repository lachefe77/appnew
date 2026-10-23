const test = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { db, hashPassword } = require('../db');
function fixture(role = 'user') {
  const h = hashPassword('Operational-test-123');
  const id = db
    .prepare(
      "INSERT INTO users(uuid,name,email,password_hash,salt,api_key,role,balance_cents) VALUES(?,'Operations',?,?,?,?,?,100000)"
    )
    .run(
      crypto.randomUUID(),
      crypto.randomUUID() + '@test.invalid',
      h.hash,
      h.salt,
      crypto.randomUUID(),
      role
    ).lastInsertRowid;
  return db.prepare('SELECT * FROM users WHERE id=?').get(id);
}
test('Agendamento ISO executa uma vez e respeita férias', () => {
  const u = fixture(),
    s = db
      .prepare("SELECT * FROM services WHERE status='active' LIMIT 1")
      .get();
  const id = db
    .prepare(
      'INSERT INTO scheduled_orders(user_id,service_id,link,quantity,run_at) VALUES(?,?,?,?,?)'
    )
    .run(
      u.id,
      s.id,
      'https://instagram.com/test',
      s.min_quantity,
      new Date(Date.now() - 60000).toISOString()
    ).lastInsertRowid;
  const { scheduledTick } = require('../automation-domain');
  db.prepare(
    "INSERT INTO vacation_mode(user_id,starts_at,ends_at) VALUES(?,datetime('now','-1 day'),datetime('now','+1 day'))"
  ).run(u.id);
  scheduledTick();
  assert.equal(
    db.prepare('SELECT status FROM scheduled_orders WHERE id=?').get(id).status,
    'pending'
  );
  db.prepare('DELETE FROM vacation_mode WHERE user_id=?').run(u.id);
  scheduledTick();
  scheduledTick();
  assert.equal(
    db.prepare('SELECT status FROM scheduled_orders WHERE id=?').get(id).status,
    'executed'
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM automation_orders WHERE kind='schedule' AND config_id=?"
      )
      .get(id).n,
    1
  );
});
test('Autopilot mantém orçamento e não repete competência', () => {
  const u = fixture(),
    s = db
      .prepare("SELECT * FROM services WHERE status='active' LIMIT 1")
      .get();
  const budget = 10000;
  const id = db
    .prepare(
      'INSERT INTO autopilot_configs(user_id,budget_monthly_cents,allocation_json) VALUES(?,?,?)'
    )
    .run(
      u.id,
      budget,
      JSON.stringify([
        { service_id: s.id, link: 'https://instagram.com/test', pct: 100 },
      ])
    ).lastInsertRowid;
  const { autopilotTick } = require('../automation-domain');
  autopilotTick();
  const first = db
    .prepare('SELECT balance_cents FROM users WHERE id=?')
    .get(u.id).balance_cents;
  autopilotTick();
  const second = db
    .prepare('SELECT balance_cents FROM users WHERE id=?')
    .get(u.id).balance_cents;
  assert.equal(first, second);
  assert.ok(100000 - second <= budget);
  assert.ok(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM automation_runs WHERE kind='autopilot' AND config_id=?"
      )
      .get(id).n <= 1
  );
});
test('Rotação de chave usa data da chave, sem repetir a cada chamada', () => {
  const u = fixture();
  db.prepare("UPDATE users SET created_at='2020-01-01' WHERE id=?").run(u.id);
  const rotate = require('../jobs/api-key-rotation').rotateOldKeys;
  assert.ok(rotate().rotated >= 1);
  const key = db
    .prepare('SELECT api_key FROM users WHERE id=?')
    .get(u.id).api_key;
  rotate();
  assert.equal(
    db.prepare('SELECT api_key FROM users WHERE id=?').get(u.id).api_key,
    key
  );
});
test('Sessão delegada expira com alteração das credenciais do operador', () => {
  const actor = fixture('admin'),
    target = fixture();
  const auth = require('../auth');
  const token = auth.signToken(target, { actor });
  assert.equal(auth.verifyToken(token).delegated_by, actor.id);
  db.prepare(
    'UPDATE users SET session_version=session_version+1 WHERE id=?'
  ).run(actor.id);
  assert.equal(auth.verifyToken(token), null);
});
test('Backup consistente e restauração recuperam banco de teste', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smm-backup-test-'));
  const { spawnSync } = require('node:child_process');
  const root = path.resolve(__dirname, '../..');
  try {
    const r = spawnSync(process.execPath, ['scripts/backup.cjs'], {
      cwd: root,
      env: { ...process.env, BACKUP_DIR: dir },
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    const backup = r.stdout.trim().split(/\r?\n/).at(-1);
    assert.ok(fs.existsSync(backup));
    const target = path.join(dir, 'restored.sqlite');
    const restored = spawnSync(
      process.execPath,
      ['scripts/restore.cjs', backup],
      { cwd: root, env: { ...process.env, DB_PATH: target }, encoding: 'utf8' }
    );
    assert.equal(restored.status, 0, restored.stderr);
    const { DatabaseSync } = require('node:sqlite');
    const copy = new DatabaseSync(target, { readOnly: true });
    assert.equal(copy.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.ok(copy.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0);
    copy.close();
  } finally {
    if (path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep))
      fs.rmSync(dir, { recursive: true, force: true });
  }
});
