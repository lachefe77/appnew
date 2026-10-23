const express = require('express');
const { db, debitBalanceAtomic, creditBalanceAtomic, tx } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const COST_CENTS = 1000;

router.post('/open', (req, res) => {
  try {
    const roll = require('node:crypto').randomInt(10000) / 100;
    let prizeCents = 400,
      prizeLabel = 'COMUM (R$ 4,00)';
    if (roll < 5) {
      prizeCents = 3000;
      prizeLabel = 'MÍTICO (R$ 30,00)';
    } else if (roll < 20) {
      prizeCents = 1500;
      prizeLabel = 'RARO (R$ 15,00)';
    } else if (roll < 50) {
      prizeCents = 800;
      prizeLabel = 'ESPECIAL (R$ 8,00)';
    }

    const result = tx(() => {
      const total = db
        .prepare('SELECT total_deposited_cents FROM users WHERE id=?')
        .get(req.user.id).total_deposited_cents;
      const count = db
        .prepare(
          "SELECT COUNT(*) AS n FROM lootbox_rolls WHERE user_id=? AND DATE(created_at)=DATE('now')"
        )
        .get(req.user.id).n;
      if (total < 500 || count >= 3)
        return {
          err: 'Requer depósito confirmado e permite até três aberturas diárias.',
        };
      const afterDebit = debitBalanceAtomic(req.user.id, COST_CENTS);
      if (afterDebit === null)
        return { err: 'Saldo insuficiente. Caixa custa R$ 10,00.' };
      const afterPrize = creditBalanceAtomic(req.user.id, prizeCents);
      db.prepare(
        `INSERT INTO lootbox_rolls (user_id, cost_cents, prize_cents, prize_label) VALUES (?,?,?,?)`
      ).run(req.user.id, COST_CENTS, prizeCents, prizeLabel);
      db.prepare(
        `INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents, description)
        VALUES (?, 'lootbox_spin', ?, ?, ?)`
      ).run(
        req.user.id,
        prizeCents - COST_CENTS,
        afterPrize,
        `Caixa Misteriosa: ${prizeLabel}`
      );
      return { newBal: afterPrize };
    });

    if (result.err) return res.status(400).json({ error: result.err });
    res.json({
      message: `Você ganhou ${prizeLabel}!`,
      prize_cents: prizeCents,
      prize_label: prizeLabel,
      prize_formatted: `R$ ${(prizeCents / 100).toFixed(2).replace('.', ',')}`,
      cost_formatted: 'R$ 10,00',
      new_balance_cents: result.newBal,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', (req, res) => {
  const rolls = db
    .prepare(
      `SELECT lr.*, u.name as user_name FROM lootbox_rolls lr
    JOIN users u ON lr.user_id = u.id ORDER BY lr.id DESC LIMIT 10`
    )
    .all();
  res.json({ rolls });
});

module.exports = router;
