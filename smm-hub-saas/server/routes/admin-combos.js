const router = require('express').Router();
const { db, tx } = require('../db');
const { requireAdmin } = require('../auth');
router.use(requireAdmin);
router.get('/combos', (req, res) =>
  res.json({
    combos: db
      .prepare('SELECT * FROM combos ORDER BY id DESC LIMIT 100')
      .all()
      .map((combo) => ({ ...combo, items: JSON.parse(combo.items_json) })),
  }),
);
function audit(req, id, action) {
  db.prepare(
    'INSERT INTO system_audit_logs(admin_id,action,target,ip,details) VALUES(?,?,?,?,?)',
  ).run(
    req.user.id,
    action,
    'combo:' + id,
    req.ip,
    'Configuração de promoção atualizada',
  );
}
router.post('/combos', (req, res) => {
  try {
    const value = require('../combo-domain').definition(req.body);
    const id = tx(() => {
      const row = db
        .prepare(
          'INSERT INTO combos(name,description,items_json,price_cents,regular_cents) VALUES(?,?,?,?,?)',
        )
        .run(
          value.name,
          value.description,
          JSON.stringify(value.items),
          value.price_cents,
          value.regular_cents,
        );
      audit(req, Number(row.lastInsertRowid), 'combo_create');
      return Number(row.lastInsertRowid);
    });
    res.status(201).json({ id, message: 'Combo publicado.' });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});
router.put('/combos/:id', (req, res) => {
  try {
    if (!db.prepare('SELECT id FROM combos WHERE id=?').get(req.params.id))
      return res.status(404).json({ error: 'Combo não encontrado.' });
    const value = require('../combo-domain').definition(req.body);
    tx(() => {
      db.prepare(
        'UPDATE combos SET name=?,description=?,items_json=?,price_cents=?,regular_cents=? WHERE id=?',
      ).run(
        value.name,
        value.description,
        JSON.stringify(value.items),
        value.price_cents,
        value.regular_cents,
        req.params.id,
      );
      audit(req, req.params.id, 'combo_update');
    });
    res.json({ message: 'Combo atualizado.' });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});
router.post('/combos/:id/status', (req, res) => {
  if (![0, 1].includes(req.body.is_active))
    return res.status(400).json({ error: 'Estado inválido.' });
  const row = db.prepare('SELECT id FROM combos WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Combo não encontrado.' });
  tx(() => {
    db.prepare('UPDATE combos SET is_active=? WHERE id=?').run(
      req.body.is_active,
      row.id,
    );
    audit(req, row.id, 'combo_status');
  });
  res.json({
    message: req.body.is_active ? 'Combo publicado.' : 'Combo pausado.',
  });
});
module.exports = router;
