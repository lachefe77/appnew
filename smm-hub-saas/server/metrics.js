const { db } = require('./db');

const counters = {
  orders_created_total: 0,
  orders_completed_total: 0,
  orders_failed_total: 0,
  pix_created_total: 0,
  pix_paid_total: 0,
  login_total: 0,
  login_failed_total: 0,
  http_requests_total: 0,
};

function inc(name, n = 1) {
  if (counters[name] !== undefined) counters[name] += n;
}
const bounds = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  buckets = bounds.map(() => 0);
let count = 0,
  total = 0,
  errors = 0;
function observeHttp(ms, status) {
  const seconds = ms / 1000;
  count++;
  total += seconds;
  if (status >= 500) errors++;
  bounds.forEach((b, i) => {
    if (seconds <= b) buckets[i]++;
  });
}

function render() {
  const now = Date.now();
  const dbStats = {
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    orders_active: db
      .prepare(
        "SELECT COUNT(*) as c FROM orders WHERE status IN ('pending','processing','in_progress')"
      )
      .get().c,
    orders_total: db.prepare('SELECT COUNT(*) as c FROM orders').get().c,
    pix_pending: db
      .prepare("SELECT COUNT(*) as c FROM pix_invoices WHERE status='pending'")
      .get().c,
    tickets_open: db
      .prepare("SELECT COUNT(*) as c FROM tickets WHERE status='open'")
      .get().c,
  };

  const lines = [
    '# HELP smm_users_total Total registered users',
    '# TYPE smm_users_total gauge',
    `smm_users_total ${dbStats.users}`,
    '# HELP smm_orders_total Total orders',
    '# TYPE smm_orders_total counter',
    `smm_orders_total ${dbStats.orders_total}`,
    '# HELP smm_orders_active Orders in progress or pending',
    '# TYPE smm_orders_active gauge',
    `smm_orders_active ${dbStats.orders_active}`,
    '# HELP smm_pix_pending Pending Pix invoices',
    '# TYPE smm_pix_pending gauge',
    `smm_pix_pending ${dbStats.pix_pending}`,
    '# HELP smm_tickets_open Open support tickets',
    '# TYPE smm_tickets_open gauge',
    `smm_tickets_open ${dbStats.tickets_open}`,
  ];
  const persistent = {
    orders_created_total: dbStats.orders_total,
    orders_completed_total: db
      .prepare(
        "SELECT COUNT(*) AS n FROM order_effects WHERE effect='completed'"
      )
      .get().n,
    orders_failed_total: db
      .prepare(
        "SELECT COUNT(*) AS n FROM order_events WHERE event_type='status.failed'"
      )
      .get().n,
  };
  for (const [k, v] of Object.entries({ ...counters, ...persistent })) {
    lines.push(`# TYPE smm_${k} counter`);
    lines.push(`smm_${k} ${v}`);
  }
  lines.push(`# HELP smm_last_scrape_timestamp Last Prometheus scrape`);
  lines.push(`smm_last_scrape_timestamp ${now / 1000}`);
  lines.push('# TYPE smm_http_duration_seconds histogram');
  bounds.forEach((b, i) =>
    lines.push(`smm_http_duration_seconds_bucket{le="${b}"} ${buckets[i]}`)
  );
  lines.push(
    `smm_http_duration_seconds_bucket{le="+Inf"} ${count}`,
    `smm_http_duration_seconds_count ${count}`,
    `smm_http_duration_seconds_sum ${total}`,
    `smm_http_server_errors_total ${errors}`
  );
  return lines.join('\n') + '\n';
}

module.exports = { inc, render, counters, observeHttp };
