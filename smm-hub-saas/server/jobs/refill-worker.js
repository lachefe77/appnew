const { db } = require('../db');
const { providerFetch } = require('../provider-client');
async function tick() {
  const rows = db
    .prepare(
      "SELECT r.id,r.remote_id,p.api_url,p.api_key FROM order_refills r JOIN orders o ON o.id=r.order_id JOIN providers p ON p.id=COALESCE(r.provider_id,o.provider_id) WHERE r.status='processing' AND r.remote_id IS NOT NULL ORDER BY r.updated_at,r.id LIMIT 25"
    )
    .all();
  for (const row of rows) {
    db.prepare(
      'UPDATE order_refills SET updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ).run(row.id);
    try {
      const form = new URLSearchParams({
        key: row.api_key,
        action: 'refill_status',
        refill: row.remote_id,
      });
      const response = await providerFetch(row.api_url, {
        body: form.toString(),
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json();
      const remote = String(data.status || '')
        .trim()
        .toLowerCase();
      const status = {
        completed: 'completed',
        complete: 'completed',
        rejected: 'failed',
        failed: 'failed',
        canceled: 'failed',
        cancelled: 'failed',
      }[remote];
      if (status)
        db.prepare(
          "UPDATE order_refills SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='processing'"
        ).run(status, row.id);
    } catch (error) {
      require('../logger').warn(
        { refillId: row.id, error: error.message },
        'Consulta de reposição falhou'
      );
    }
  }
}
function start() {
  return require('../worker-lease').startLeased('refill-progress', tick, 60000);
}
module.exports = { tick, start };
