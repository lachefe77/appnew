const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

router.post('/track', requireAuth, (req, res) => {
  const { visitor_id } = req.body;
  if (!visitor_id || !/^[a-zA-Z0-9]{8,64}$/.test(visitor_id)) return res.status(400).json({ error: 'visitor_id inválido.' });
  try {
    db.prepare(`INSERT INTO device_fingerprints (user_id, visitor_id, ip, user_agent)
      VALUES (?,?,?,?)`).run(req.user.id, visitor_id, req.ip, (req.headers['user-agent'] || '').substring(0, 200));
  } catch (e) {
    db.prepare(`UPDATE device_fingerprints SET seen_at = CURRENT_TIMESTAMP WHERE user_id = ? AND visitor_id = ?`)
      .run(req.user.id, visitor_id);
  }

  // Detecta multi-conta no mesmo device
  const sharedAccounts = db.prepare(`SELECT user_id FROM device_fingerprints WHERE visitor_id = ?`).all(visitor_id);
  res.json({ tracked: true, shared_device_users: sharedAccounts.length });
});

module.exports = router;
