const { db } = require('./db');
const config = require('./config');
function stats() {
  const users = db
    .prepare(
      "SELECT COUNT(*) AS n FROM users WHERE role IN ('user','vip') AND status='active' AND deleted_at IS NULL AND email!=?"
    )
    .get(config.adminSeed.demoEmail).n;
  const orders = db
    .prepare(
      "SELECT COALESCE(SUM(o.quantity),0) AS n FROM orders o JOIN providers p ON o.provider_id=p.id WHERE o.status='completed' AND p.is_mock=0"
    )
    .get().n;
  const reviews = db
    .prepare(
      'SELECT COUNT(*) AS n,SUM(CASE WHEN rating>=4 THEN 1 ELSE 0 END) AS good FROM order_reviews'
    )
    .get();
  const catalog = db
    .prepare(
      "SELECT COUNT(*) AS services, COUNT(DISTINCT platform) AS platforms FROM services WHERE status='active'"
    )
    .get();
  const providers = db
    .prepare(
      "SELECT SUM(CASE WHEN is_mock=0 AND status='active' THEN 1 ELSE 0 END) AS real_providers, COUNT(*) AS providers FROM providers"
    )
    .get();
  return {
    total_users: users,
    total_delivered: orders,
    active_services: catalog.services,
    active_platforms: catalog.platforms,
    real_providers: providers.real_providers || 0,
    total_countries: null,
    satisfaction_pct: reviews.n
      ? Math.round((reviews.good * 10000) / reviews.n) / 100
      : null,
    uptime: null,
    average_start_seconds: null,
    updated_at: new Date().toISOString(),
  };
}
module.exports = { stats };
