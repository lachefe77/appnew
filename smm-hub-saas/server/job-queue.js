const crypto = require('node:crypto');
const { db } = require('./db');
const handlers = new Map();
let busy = false;
function registerHandler(name, fn) {
  handlers.set(name, fn);
}
function enqueue(name, payload = {}, options = {}) {
  const id = options.id || crypto.randomUUID();
  db.prepare(
    "INSERT OR IGNORE INTO job_queue(id,name,payload,status,next_run,subject_user_id) VALUES(?,?,?,'pending',?,?)"
  ).run(
    id,
    name,
    JSON.stringify(payload),
    new Date(Date.now() + (options.delay || 0)).toISOString(),
    options.userId || null
  );
  return id;
}
async function tick() {
  if (busy) return;
  busy = true;
  try {
    db.prepare(
      "UPDATE job_queue SET status='pending' WHERE status='running' AND datetime(locked_at)<datetime('now','-5 minutes')"
    ).run();
    const jobs = db
      .prepare(
        "SELECT * FROM job_queue WHERE status='pending' AND datetime(next_run)<=CURRENT_TIMESTAMP ORDER BY next_run LIMIT 20"
      )
      .all();
    for (const job of jobs) {
      if (!handlers.has(job.name)) continue;
      const lockToken=crypto.randomUUID();
      const claimed = db
        .prepare(
          "UPDATE job_queue SET status='running',locked_at=CURRENT_TIMESTAMP,attempts=attempts+1,lock_token=? WHERE id=? AND status='pending'"
        )
        .run(lockToken,job.id);
      if (!claimed.changes) continue;
      const heartbeat=setInterval(()=>{
        try{db.prepare("UPDATE job_queue SET locked_at=CURRENT_TIMESTAMP WHERE id=? AND lock_token=? AND status='running'").run(job.id,lockToken);}catch(error){require('./logger').error({jobId:job.id},'Falha no heartbeat da fila');}
      },30000);
      heartbeat.unref();
      try {
        await handlers.get(job.name)(JSON.parse(job.payload));
        db.prepare(
          "UPDATE job_queue SET status='completed',completed_at=CURRENT_TIMESTAMP,payload='{}',lock_token=NULL WHERE id=? AND lock_token=? AND status='running'"
        ).run(job.id,lockToken);
      } catch (e) {
        db.prepare(
          'UPDATE job_queue SET status=?,next_run=?,last_error=?,lock_token=NULL WHERE id=? AND lock_token=?'
        ).run(
          job.attempts + 1 >= 5 ? 'failed' : 'pending',
          new Date(
            Date.now() + Math.min(3600000, 2 ** job.attempts * 10000)
          ).toISOString(),
          String(e.message).slice(0, 500),
          job.id,lockToken
        );
      } finally {
        clearInterval(heartbeat);
      }
    }
  } finally {
    busy = false;
  }
}
function start() {
  return setInterval(
    () =>
      tick().catch((e) =>
        require('./logger').error({ error: e.message }, 'Fila indisponível')
      ),
    1000
  );
}
module.exports = {
  registerHandler,
  enqueue,
  tick,
  start,
  size: () =>
    db
      .prepare("SELECT COUNT(*) AS n FROM job_queue WHERE status='pending'")
      .get().n,
};
