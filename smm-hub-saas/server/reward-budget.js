const { db } = require('./db');
function remaining(userId) {
  const deposits =
    db.prepare('SELECT total_deposited_cents FROM users WHERE id=?').get(userId)
      ?.total_deposited_cents || 0;
  const credited = db
    .prepare(
      "SELECT COALESCE(SUM(amount_cents),0) AS n FROM transactions WHERE user_id=? AND type IN ('daily_spin_bonus','streak_bonus','mission_reward')"
    )
    .get(userId).n;
  return Math.max(0, Math.floor(deposits * 0.1) - credited);
}
function requireBudget(userId, amount) {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > remaining(userId))
    throw Object.assign(
      new Error(
        'Limite de bônus atingido: estes benefícios somados têm teto de 10% dos depósitos confirmados acumulados.'
      ),
      { status: 400 }
    );
}
module.exports = { remaining, requireBudget };
