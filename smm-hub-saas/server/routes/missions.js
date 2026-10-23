const router = require('express').Router();
const { db, tx, creditBalanceAtomic } = require('../db');
const { requireAuth } = require('../auth');
router.use(requireAuth);
function progressFor(userId, mission) {
  const args = [userId, mission.starts_at, mission.expires_at];
  if (mission.target_type === 'orders_count')
    return db
      .prepare(
        "SELECT COUNT(*) AS n FROM orders WHERE user_id=? AND status='completed' AND datetime(created_at) BETWEEN datetime(?) AND datetime(?)"
      )
      .get(...args).n;
  if (mission.target_type === 'spend_cents')
    return db
      .prepare(
        "SELECT COALESCE(SUM(o.charge_cents-COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.type='order_refund' AND t.reference_id=o.uuid),0)),0) AS n FROM orders o WHERE o.user_id=? AND o.status='completed' AND datetime(o.created_at) BETWEEN datetime(?) AND datetime(?)"
      )
      .get(...args).n;
  if (mission.target_type === 'reviews_count')
    return db
      .prepare(
        "SELECT COUNT(DISTINCT r.order_id) AS n FROM order_reviews r JOIN orders o ON o.id=r.order_id WHERE r.user_id=? AND o.user_id=r.user_id AND o.status='completed' AND datetime(r.created_at) BETWEEN datetime(?) AND datetime(?)"
      )
      .get(...args).n;
  return 0;
}
router.get('/', (req, res) => {
  try {
    const missions = db
      .prepare(
        'SELECT m.*,COALESCE(um.is_claimed,0) AS is_claimed,COALESCE(um.current_value,0) AS user_value FROM weekly_missions m LEFT JOIN user_missions um ON um.mission_id=m.id AND um.user_id=? ORDER BY m.id DESC LIMIT 100'
      )
      .all(req.user.id);
    res.json({
      bonus_policy:
        'Roleta, sequência diária e missões compartilham teto de 10% dos depósitos confirmados acumulados.',
      remaining_bonus_cents: require('../reward-budget').remaining(req.user.id),
      missions: missions.map((mission) => {
        const progress = mission.is_claimed
          ? mission.user_value
          : progressFor(req.user.id, mission);
        return {
          ...mission,
          user_value: progress,
          is_completed: progress >= mission.target_value ? 1 : 0,
          percent:
            mission.target_value > 0
              ? Math.min(
                  100,
                  Math.round((progress / mission.target_value) * 100)
                )
              : 0,
        };
      }),
    });
  } catch {
    res.status(500).json({ error: 'Não foi possível consultar as missões.' });
  }
});
router.post('/:id/claim', (req, res) => {
  try {
    const result = tx(() => {
      const mission = db
        .prepare('SELECT * FROM weekly_missions WHERE id=?')
        .get(req.params.id);
      const fail = (message, status = 400) => {
        throw Object.assign(new Error(message), { status });
      };
      if (!mission) fail('Missão não encontrada.', 404);
      if (
        !Number.isFinite(Date.parse(mission.starts_at)) ||
        !Number.isFinite(Date.parse(mission.expires_at)) ||
        Date.parse(mission.starts_at) > Date.now() ||
        Date.parse(mission.expires_at) <= Date.now()
      )
        fail('Missão fora do período de resgate.');
      if (
        !Number.isSafeInteger(mission.target_value) ||
        mission.target_value <= 0 ||
        !Number.isSafeInteger(mission.reward_cents) ||
        mission.reward_cents <= 0 ||
        mission.reward_cents > 100000
      )
        fail('Configuração da missão inválida.');
      if (
        db
          .prepare(
            'SELECT 1 FROM user_missions WHERE user_id=? AND mission_id=? AND is_claimed=1'
          )
          .get(req.user.id, mission.id)
      )
        fail('Recompensa já resgatada.', 409);
      const progress = progressFor(req.user.id, mission);
      if (progress < mission.target_value)
        fail('Objetivo da missão ainda não atingido.');
      db.prepare(
        'INSERT INTO user_missions(user_id,mission_id,current_value,is_completed,is_claimed,claimed_at) VALUES(?,?,?,1,1,CURRENT_TIMESTAMP) ON CONFLICT(user_id,mission_id) DO UPDATE SET current_value=excluded.current_value,is_completed=1,is_claimed=1,claimed_at=CURRENT_TIMESTAMP'
      ).run(req.user.id, mission.id, progress);
      require('../reward-budget').requireBudget(
        req.user.id,
        mission.reward_cents
      );
      const balance = creditBalanceAtomic(req.user.id, mission.reward_cents);
      if (balance === null) throw new Error('Falha no crédito.');
      db.prepare(
        "INSERT INTO transactions(user_id,type,amount_cents,balance_after_cents,reference_id,description) VALUES(?,'mission_reward',?,?,?,?)"
      ).run(
        req.user.id,
        mission.reward_cents,
        balance,
        'mission:' + mission.id + ':' + req.user.id,
        'Recompensa da missão: ' + mission.title
      );
      return {
        message: 'Recompensa creditada.',
        reward_cents: mission.reward_cents,
        new_balance_cents: balance,
      };
    });
    res.json(result);
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ error: error.status ? error.message : 'Falha no resgate.' });
  }
});
module.exports = router;
module.exports.progressFor = progressFor;
