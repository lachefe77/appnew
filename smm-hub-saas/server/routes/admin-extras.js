const express = require('express');
const { db } = require('../db');
const { requireAdmin, requireCEO } = require('../auth');
const { requireRole, VALID_ROLES } = require('../middleware/roles');
const { invalidateCache } = require('../middleware/link-blacklist');
const { captureSnapshot } = require('../jobs/financial-snapshot');

const router = express.Router();

/* ADMIN NOTES */
router.get('/users/:id/notes', requireAdmin, (req, res) => {
  const notes = db
    .prepare(
      `SELECT n.*, u.name as admin_name FROM admin_notes n
    JOIN users u ON n.admin_id = u.id WHERE n.target_user_id = ? ORDER BY n.is_pinned DESC, n.id DESC`
    )
    .all(req.params.id);
  res.json({ notes });
});

router.post('/users/:id/notes', requireAdmin, (req, res) => {
  const { note, is_pinned } = req.body;
  if (!note || !note.trim())
    return res.status(400).json({ error: 'Nota vazia.' });
  const r = db
    .prepare(
      `INSERT INTO admin_notes (target_user_id, admin_id, note, is_pinned) VALUES (?,?,?,?)`
    )
    .run(req.params.id, req.user.id, note.trim(), is_pinned ? 1 : 0);
  res.status(201).json({ message: 'Nota adicionada.', id: r.lastInsertRowid });
});

router.delete('/notes/:noteId', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM admin_notes WHERE id = ?').run(req.params.noteId);
  res.json({ message: 'Nota removida.' });
});

/* BLOCKED LINKS */
router.get('/blocked-links', requireAdmin, (req, res) => {
  res.json({
    blocked: db.prepare('SELECT * FROM blocked_links ORDER BY id DESC').all(),
  });
});

router.post('/blocked-links', requireAdmin, (req, res) => {
  const { pattern, reason } = req.body;
  if (
    typeof pattern !== 'string' ||
    pattern.trim().length < 3 ||
    pattern.length > 128
  )
    return res
      .status(400)
      .json({ error: 'Informe um trecho de texto entre 3 e 128 caracteres.' });
  const r = db
    .prepare(
      'INSERT INTO blocked_links (pattern, reason, added_by) VALUES (?,?,?)'
    )
    .run(pattern.trim(), reason || null, req.user.id);
  invalidateCache();
  res.status(201).json({ message: 'Padrão bloqueado.', id: r.lastInsertRowid });
});

router.delete('/blocked-links/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM blocked_links WHERE id = ?').run(req.params.id);
  invalidateCache();
  res.json({ message: 'Removido.' });
});

/* ROLES — somente CEO pode mudar cargos, e ninguém pode mexer no próprio CEO raiz */
router.post('/users/:id/role', requireCEO, (req, res) => {
  const { role } = req.body;
  if (!VALID_ROLES.includes(role)) {
    return res
      .status(400)
      .json({ error: `Cargo inválido. Use um de: ${VALID_ROLES.join(', ')}.` });
  }
  const target = db
    .prepare('SELECT id, role FROM users WHERE id = ?')
    .get(req.params.id);
  if (!target)
    return res.status(404).json({ error: 'Usuário não encontrado.' });

  // Proteção: CEO raiz não pode ser rebaixado (último CEO ativo)
  if (target.role === 'ceo' && role !== 'ceo') {
    const ceoCount = db
      .prepare(
        "SELECT COUNT(*) as c FROM users WHERE role = 'ceo' AND status = 'active' AND deleted_at IS NULL"
      )
      .get().c;
    if (ceoCount <= 1)
      return res
        .status(400)
        .json({ error: 'Não é possível rebaixar o último CEO.' });
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  db.prepare(
    `INSERT INTO system_audit_logs (admin_id, action, target, ip, details)
    VALUES (?, 'role_change', ?, ?, ?)`
  ).run(
    req.user.id,
    `user:${req.params.id}`,
    req.ip,
    `${target.role} → ${role}`
  );
  res.json({ message: `Cargo alterado para ${role}.` });
});

/* SNAPSHOTS */
router.get('/snapshots', requireAdmin, (req, res) => {
  const days = parseInt(req.query.days, 10) || 30;
  const rows = db
    .prepare(
      `SELECT * FROM financial_snapshots ORDER BY snapshot_date DESC LIMIT ?`
    )
    .all(days);
  res.json({ snapshots: rows.reverse() });
});

router.post('/snapshots/capture', requireAdmin, (req, res) => {
  const result = captureSnapshot();
  res.json({ message: 'Snapshot capturado.', result });
});

/* ANALYTICS CLIENTE (admin pode ver de qualquer user) */
router.get('/users/:id/analytics', requireAdmin, (req, res) => {
  const uid = req.params.id;
  const spend30 = db
    .prepare(
      `SELECT DATE(created_at) as day, SUM(charge_cents) as total
    FROM orders WHERE user_id = ? AND created_at >= datetime('now','-30 days')
    GROUP BY day ORDER BY day ASC`
    )
    .all(uid);
  const topServices = db
    .prepare(
      `SELECT s.name, s.platform, COUNT(o.id) as n, SUM(o.charge_cents) as total
    FROM orders o JOIN services s ON o.service_id = s.id
    WHERE o.user_id = ? GROUP BY s.id ORDER BY total DESC LIMIT 5`
    )
    .all(uid);
  res.json({ spend_30d: spend30, top_services: topServices });
});

/* LGPD request list */
router.get('/lgpd/requests', requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT l.*, u.name, u.email FROM lgpd_requests l
    JOIN users u ON l.user_id = u.id ORDER BY l.id DESC LIMIT 100`
    )
    .all();
  res.json({ requests: rows });
});

module.exports = router;
