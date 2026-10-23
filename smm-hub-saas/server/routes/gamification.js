const express = require('express');
const { db, creditBalanceAtomic, tx } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/status', (req, res) => {
  const lastSpin = db
    .prepare(
      `SELECT * FROM user_daily_spins WHERE user_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(req.user.id);
  let canSpin = true,
    nextSpinMs = 0;
  if (lastSpin) {
    const diff = Date.now() - new Date(lastSpin.spun_at).getTime();
    const cooldown = 24 * 3600 * 1000;
    if (diff < cooldown) {
      canSpin = false;
      nextSpinMs = cooldown - diff;
    }
  }
  res.json({
    can_spin:
      canSpin && require('../reward-budget').remaining(req.user.id) >= 50,
    remaining_bonus_cents: require('../reward-budget').remaining(req.user.id),
    next_spin_in_seconds: Math.ceil(nextSpinMs / 1000),
    last_prize_cents: lastSpin ? lastSpin.prize_cents : 0,
  });
});

router.post('/spin', (req, res) => {
  if (
    db
      .prepare('SELECT total_deposited_cents FROM users WHERE id=?')
      .get(req.user.id).total_deposited_cents < 500
  )
    return res
      .status(403)
      .json({ error: 'Bônus monetários requerem depósito confirmado.' });
  const lastSpin = db
    .prepare(
      `SELECT * FROM user_daily_spins WHERE user_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(req.user.id);
  if (lastSpin) {
    const diff = Date.now() - new Date(lastSpin.spun_at).getTime();
    if (diff < 24 * 3600 * 1000) {
      const h = Math.ceil((24 * 3600 * 1000 - diff) / 3600000);
      return res.status(400).json({ error: `Volte em ${h} horas.` });
    }
  }

  const rand = require('node:crypto').randomInt(10000) / 100;
  let prizeCents = 50,
    prizeLabel = 'R$ 0,50';
  if (rand < 2) {
    prizeCents = 1000;
    prizeLabel = 'R$ 10,00 (JACKPOT!)';
  } else if (rand < 10) {
    prizeCents = 500;
    prizeLabel = 'R$ 5,00';
  } else if (rand < 25) {
    prizeCents = 250;
    prizeLabel = 'R$ 2,50';
  } else if (rand < 50) {
    prizeCents = 100;
    prizeLabel = 'R$ 1,00';
  }

  const result = tx(() => {
    const recent = db
      .prepare(
        "SELECT id FROM user_daily_spins WHERE user_id=? AND datetime(spun_at)>datetime('now','-24 hours') LIMIT 1"
      )
      .get(req.user.id);
    if (recent)
      throw Object.assign(new Error('Aguarde 24 horas entre giros.'), {
        status: 400,
      });
    const remaining = require('../reward-budget').remaining(req.user.id);
    if (remaining < 50)
      throw Object.assign(
        new Error('Limite de bônus atingido. Consulte as condições no painel.'),
        { status: 400 }
      );
    prizeCents = Math.min(prizeCents, remaining);
    prizeLabel = 'R$ ' + (prizeCents / 100).toFixed(2).replace('.', ',');
    require('../reward-budget').requireBudget(req.user.id, prizeCents);
    db.prepare(
      `INSERT INTO user_daily_spins (user_id, prize_cents) VALUES (?, ?)`
    ).run(req.user.id, prizeCents);
    const newBal = creditBalanceAtomic(req.user.id, prizeCents);
    db.prepare(
      `INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents, description)
      VALUES (?, 'daily_spin_bonus', ?, ?, ?)`
    ).run(req.user.id, prizeCents, newBal, `Roleta da Sorte (${prizeLabel})`);
    return newBal;
  });

  res.json({
    message: `Parabéns! ${prizeLabel} creditado.`,
    prize_cents: prizeCents,
    prize_label: prizeLabel,
    new_balance_cents: result,
    new_balance_formatted: `R$ ${(result / 100).toFixed(2).replace('.', ',')}`,
  });
});

module.exports = router;
