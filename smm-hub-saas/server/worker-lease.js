const crypto = require('node:crypto');
const { db } = require('./db');
const active = new Set();
async function runLeased(name, fn) {
  if (active.has(name)) return false;
  const owner = crypto.randomUUID(),
    duration = 90000;
  const claimed = db
    .prepare(
      'INSERT INTO worker_leases(name,owner,expires_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE worker_leases.expires_at<?'
    )
    .run(name, owner, Date.now() + duration, Date.now());
  if (!claimed.changes) return false;
  active.add(name);
  const heartbeat = setInterval(() => {
    try {
      db.prepare(
        'UPDATE worker_leases SET expires_at=? WHERE name=? AND owner=?'
      ).run(Date.now() + duration, name, owner);
    } catch (error) {
      require('./logger').error(
        { name, error: error.message },
        'Falha ao renovar lease'
      );
    }
  }, 20000);
  heartbeat.unref();
  try {
    await fn();
    return true;
  } finally {
    clearInterval(heartbeat);
    active.delete(name);
    db.prepare('DELETE FROM worker_leases WHERE name=? AND owner=?').run(
      name,
      owner
    );
  }
}
function startLeased(name, fn, interval) {
  return setInterval(
    () =>
      runLeased(name, fn).catch((error) =>
        require('./logger').error(
          { name, error: error.message },
          'Worker falhou'
        )
      ),
    interval
  );
}
module.exports = { runLeased, startLeased };
