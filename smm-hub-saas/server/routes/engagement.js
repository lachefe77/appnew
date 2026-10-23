const express = require('express');
const { db, creditBalanceAtomic, tx } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();

/* 28. DAILY STREAK */
router.post('/streak/checkin', requireAuth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  const result = tx(() => {
    const row = db
      .prepare('SELECT * FROM daily_streaks WHERE user_id = ?')
      .get(req.user.id);
    if (!row) {
      db.prepare(
        `INSERT INTO daily_streaks (user_id, current_streak, best_streak, last_login_date, total_logins)
        VALUES (?, 1, 1, ?, 1)`
      ).run(req.user.id, today);
      return { streak: 1, bonus: 0 };
    }
    if (row.last_login_date === today)
      return { streak: row.current_streak, bonus: 0, already: true };

    const y = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    let streak = row.last_login_date === y ? row.current_streak + 1 : 1;
    const best = Math.max(streak, row.best_streak);
    db.prepare(
      `UPDATE daily_streaks SET current_streak=?, best_streak=?, last_login_date=?, total_logins=total_logins+1 WHERE user_id=?`
    ).run(streak, best, today, req.user.id);

    const bonuses = { 3: 100, 7: 300, 14: 1000, 30: 5000 };
    let bonus = 0;
    if (
      bonuses[streak] &&
      db
        .prepare('SELECT total_deposited_cents FROM users WHERE id=?')
        .get(req.user.id).total_deposited_cents >= 500
    ) {
      bonus = Math.min(
        bonuses[streak],
        require('../reward-budget').remaining(req.user.id)
      );
      if (bonus <= 0)
        return {
          streak,
          bonus: 0,
          best_streak: best,
          bonus_limit_reached: true,
        };
      require('../reward-budget').requireBudget(req.user.id, bonus);
      const bal = creditBalanceAtomic(req.user.id, bonus);
      db.prepare(
        `INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents, description)
        VALUES (?, 'streak_bonus', ?, ?, ?)`
      ).run(
        req.user.id,
        bonus,
        bal,
        `Streak de ${streak} dias (+R$ ${(bonus / 100).toFixed(2)})`
      );
    }
    return { streak, bonus, best_streak: best };
  });
  res.json(result);
});

router.get('/streak', requireAuth, (req, res) => {
  res.json({
    streak:
      db
        .prepare('SELECT * FROM daily_streaks WHERE user_id = ?')
        .get(req.user.id) || null,
  });
});

/* 27. GIVEAWAYS */
router.get('/giveaways', (req, res) => {
  const list = db
    .prepare(
      `SELECT * FROM giveaways WHERE status='open' AND CURRENT_TIMESTAMP BETWEEN datetime(starts_at) AND datetime(ends_at) ORDER BY ends_at ASC`
    )
    .all();
  res.json({ giveaways: list });
});

router.post('/giveaways/:id/enter', requireAuth, (req, res) => {
  const g = db
    .prepare(
      `SELECT * FROM giveaways WHERE id = ? AND status='open' AND CURRENT_TIMESTAMP BETWEEN datetime(starts_at) AND datetime(ends_at)`
    )
    .get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Sorteio inválido.' });
  const dep = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents),0) as total FROM transactions WHERE user_id = ? AND type IN ('deposit_pix','deposit_crypto') AND datetime(created_at) BETWEEN datetime(?) AND datetime(?)`
    )
    .get(req.user.id, g.starts_at, g.ends_at);
  if (dep.total < g.min_deposit_cents)
    return res.status(400).json({
      error: `Depósito mínimo de R$ ${(g.min_deposit_cents / 100).toFixed(2)} no período para participar.`,
    });
  try {
    db.prepare(
      `INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?,?)`
    ).run(g.id, req.user.id);
    res.json({ message: 'Entrada confirmada! Boa sorte 🍀' });
  } catch {
    res.json({ message: 'Você já está inscrito.' });
  }
});

router.post('/giveaways', requireAdmin, (req, res) => {
  const {
    title,
    description,
    prize_cents,
    min_deposit_cents,
    starts_at,
    ends_at,
  } = req.body;
  if (
    typeof title !== 'string' ||
    !title.trim() ||
    title.length > 150 ||
    (description != null &&
      (typeof description !== 'string' || description.length > 2000)) ||
    !Number.isSafeInteger(prize_cents) ||
    prize_cents < 1 ||
    prize_cents > 1000000 ||
    !Number.isSafeInteger(min_deposit_cents) ||
    min_deposit_cents < 0 ||
    !Number.isFinite(Date.parse(starts_at)) ||
    !Number.isFinite(Date.parse(ends_at)) ||
    Date.parse(ends_at) <= Date.parse(starts_at)
  )
    return res
      .status(400)
      .json({ error: 'Título, prêmio, depósito ou período inválido.' });
  const r = db
    .prepare(
      `INSERT INTO giveaways (title, description, prize_cents, min_deposit_cents, starts_at, ends_at)
    VALUES (?,?,?,?,?,?)`
    )
    .run(
      title.trim(),
      description || null,
      prize_cents,
      min_deposit_cents,
      new Date(starts_at).toISOString(),
      new Date(ends_at).toISOString()
    );
  res.status(201).json({ id: r.lastInsertRowid });
});

router.post('/giveaways/:id/draw', requireAdmin, (req, res) => {
  const g = db
    .prepare('SELECT * FROM giveaways WHERE id = ?')
    .get(req.params.id);
  if (!g || g.winner_user_id)
    return res.status(400).json({ error: 'Sorteio inválido ou já realizado.' });
  if (g.status !== 'open' || Date.parse(g.ends_at) > Date.now())
    return res
      .status(409)
      .json({ error: 'Aguarde o encerramento do período.' });
  const entries = db
    .prepare(
      "SELECT e.user_id FROM giveaway_entries e JOIN users u ON u.id=e.user_id WHERE e.giveaway_id = ? AND u.status='active' AND u.deleted_at IS NULL"
    )
    .all(g.id);
  if (!entries.length)
    return res.status(400).json({ error: 'Sem participantes.' });
  const winner = entries[require('node:crypto').randomInt(entries.length)];
  tx(() => {
    const claimed = db
      .prepare(
        "UPDATE giveaways SET winner_user_id=?,drawn_at=CURRENT_TIMESTAMP,status='drawn' WHERE id=? AND status='open' AND winner_user_id IS NULL"
      )
      .run(winner.user_id, g.id);
    if (!claimed.changes)
      throw Object.assign(new Error('Sorteio já realizado.'), { status: 409 });
    const bal = creditBalanceAtomic(winner.user_id, g.prize_cents);
    if (bal === null) throw new Error('Conta não pode receber o prêmio.');
    db.prepare(
      `INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents, description)
      VALUES (?, 'giveaway_prize', ?, ?, ?)`
    ).run(winner.user_id, g.prize_cents, bal, `Prêmio do sorteio: ${g.title}`);
  });
  res.json({ winner_user_id: winner.user_id });
});

/* 29. CHALLENGES */
router.get('/challenges', requireAuth, (req, res) => {
  const m = new Date().toISOString().substring(0, 7);
  const list = db
    .prepare(`SELECT * FROM challenges WHERE month = ? AND status = 'open'`)
    .all(m);
  const myStats = {};
  for (const c of list) {
    if (c.target_type === 'spend_cents') {
      myStats[c.id] = db
        .prepare(
          `SELECT COALESCE(SUM(charge_cents),0) as v FROM orders
        WHERE user_id = ? AND substr(created_at,1,7) = ?`
        )
        .get(req.user.id, m).v;
    } else if (c.target_type === 'orders_count') {
      myStats[c.id] = db
        .prepare(
          `SELECT COUNT(*) as v FROM orders
        WHERE user_id = ? AND substr(created_at,1,7) = ?`
        )
        .get(req.user.id, m).v;
    }
  }
  res.json({ challenges: list, my_progress: myStats });
});

/* 30. ORDER TEMPLATES */
router.get('/templates', requireAuth, (req, res) => {
  res.json({
    templates: db
      .prepare(
        `SELECT * FROM order_templates WHERE user_id = ? OR is_public = 1 ORDER BY uses_count DESC LIMIT 50`
      )
      .all(req.user.id),
  });
});
router.post('/templates', requireAuth, (req, res) => {
  const { name, service_id, quantity, is_public } = req.body;
  const r = db
    .prepare(
      `INSERT INTO order_templates (user_id, name, service_id, quantity, is_public)
    VALUES (?,?,?,?,?)`
    )
    .run(req.user.id, name, service_id, quantity, is_public ? 1 : 0);
  res.status(201).json({ id: r.lastInsertRowid });
});
router.delete('/templates/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM order_templates WHERE id = ? AND user_id = ?').run(
    req.params.id,
    req.user.id
  );
  res.json({ ok: true });
});

/* 31. COMBOS */
router.get('/combos', (req, res) => {
  res.json({
    combos: require('../combo-domain').list(),
  });
});
router.post('/combos', requireAdmin, (req, res) => {
  let value;try{value=require('../combo-domain').definition(req.body);}catch(error){return res.status(error.status||400).json({error:error.message});}
  const { name, description, items, price_cents, regular_cents } = value;
  const r = db
    .prepare(
      `INSERT INTO combos (name, description, items_json, price_cents, regular_cents)
    VALUES (?,?,?,?,?)`
    )
    .run(
      name,
      description || null,
      JSON.stringify(items),
      price_cents,
      regular_cents
    );
  res.status(201).json({ id: r.lastInsertRowid });
});

/* 32. UTM TRACKING */
router.post('/utm/track', (req, res) => {
  const { visitor_id, source, medium, campaign } = req.body;
  if (
    typeof visitor_id !== 'string' ||
    !/^[a-zA-Z0-9_-]{8,128}$/.test(visitor_id) ||
    [source, medium, campaign].some(
      (x) => x != null && (typeof x !== 'string' || x.length > 128)
    )
  )
    return res
      .status(400)
      .json({ error: 'Parâmetros de atribuição inválidos.' });
  db.prepare(
    `INSERT INTO anonymous_attribution (visitor_id,source,medium,campaign) VALUES (?,?,?,?)`
  ).run(visitor_id, source || null, medium || null, campaign || null);
  res.json({ ok: true });
});

/* 33. PRESS KIT PÚBLICO */
router.get('/press-kit', (req, res) => {
  const latest = require('../public-stats').stats();
  res.json({
    stats: latest,
    media_contact: {
      email: db
        .prepare("SELECT value FROM site_content WHERE key='company.email'")
        .get()?.value,
      whatsapp: db
        .prepare("SELECT value FROM site_content WHERE key='company.whatsapp'")
        .get()?.value,
    },
  });
});

module.exports = router;
