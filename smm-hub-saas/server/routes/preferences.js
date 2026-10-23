const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const row = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(req.user.id);
  res.json({ preferences: row || { user_id: req.user.id, theme: 'neo-shinjuku', language: 'pt', currency: 'BRL', notifications_email: 1, notifications_push: 1 } });
});

router.put('/', (req, res) => {
  const { theme, language, currency, notifications_email, notifications_push } = req.body;
  db.prepare(`INSERT INTO user_preferences (user_id, theme, language, currency, notifications_email, notifications_push, updated_at)
    VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme, language=excluded.language,
    currency=excluded.currency, notifications_email=excluded.notifications_email,
    notifications_push=excluded.notifications_push, updated_at=CURRENT_TIMESTAMP`)
    .run(req.user.id, theme || 'neo-shinjuku', language || 'pt', currency || 'BRL',
      notifications_email ? 1 : 0, notifications_push ? 1 : 0);
  res.json({ message: 'Preferências salvas.' });
});

module.exports = router;
