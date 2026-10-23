const express = require('express');
const { db } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const logger = require('../logger');

const router = express.Router();

router.get('/freeze-status', (req, res) => {
  const s = db.prepare("SELECT value FROM settings WHERE key = 'freeze_mode'").get();
  res.json({ is_frozen: s && s.value === '1' });
});

router.post('/freeze-toggle', requireAdmin, (req, res) => {
  try {
    const s = db.prepare("SELECT value FROM settings WHERE key = 'freeze_mode'").get();
    const next = (s && s.value === '1') ? '0' : '1';
    db.prepare("UPDATE settings SET value = ? WHERE key = 'freeze_mode'").run(next);
    db.prepare(`INSERT INTO system_audit_logs (admin_id, action, target, ip, details)
      VALUES (?, 'toggle_freeze_mode', 'system', ?, ?)`).run(req.user.id, req.ip, `Freeze → ${next === '1' ? 'ON' : 'OFF'}`);
    logger.warn({ frozen: next === '1' }, 'Freeze mode toggled');
    res.json({ message: next === '1' ? '🚨 Emergência ATIVA.' : '✅ Emergência desativada.', is_frozen: next === '1' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/audit-logs', requireAdmin, (req, res) => {
  const logs = db.prepare(`SELECT l.*, u.name as admin_name, u.email as admin_email
    FROM system_audit_logs l LEFT JOIN users u ON l.admin_id = u.id ORDER BY l.id DESC LIMIT 100`).all();
  res.json({ logs });
});

module.exports = router;
