const router = require('express').Router();
const { db, tx } = require('../db');
const { requireStaff } = require('../auth');
router.use(requireStaff);
router.get('/tickets', (req, res) =>
  res.json({
    tickets: db
      .prepare(
        'SELECT t.id,t.subject,t.status,t.priority,t.updated_at,u.name AS user_name FROM tickets t JOIN users u ON t.user_id=u.id ORDER BY t.updated_at DESC LIMIT 100'
      )
      .all(),
  })
);
router.get('/tickets/:id', (req, res) => {
  const ticket = db
    .prepare(
      'SELECT id,subject,status,priority,user_id,order_id FROM tickets WHERE id=?'
    )
    .get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado.' });
  const messages = db
    .prepare(
      'SELECT m.id,m.message,m.is_staff,m.created_at,u.name AS sender_name FROM ticket_messages m JOIN users u ON m.user_id=u.id WHERE ticket_id=? ORDER BY m.id'
    )
    .all(ticket.id);
  for (const message of messages)
    message.attachments = db
      .prepare(
        'SELECT id,filename,mime_type,size_bytes FROM ticket_attachments WHERE message_id=?'
      )
      .all(message.id);
  res.json({ ticket, messages });
});
router.post('/tickets/:id/reply', (req, res) => {
  const { message, close, attachments } = req.body;
  if (typeof message !== 'string' || !message.trim() || message.length > 10000)
    return res.status(400).json({ error: 'Mensagem inválida.' });
  const ticket = db
    .prepare('SELECT id FROM tickets WHERE id=?')
    .get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado.' });
  try {
    tx(() => {
      const inserted = db
        .prepare(
          'INSERT INTO ticket_messages(ticket_id,user_id,is_staff,message) VALUES(?,?,1,?)'
        )
        .run(ticket.id, req.user.id, message.trim());
      require('../ticket-attachments').attachToMessage(
        inserted.lastInsertRowid,
        attachments
      );
      db.prepare(
        'UPDATE tickets SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
      ).run(close === true ? 'closed' : 'answered', ticket.id);
      db.prepare(
        "INSERT INTO system_audit_logs(admin_id,action,target,ip,details) VALUES(?,'support_reply',?,?,?)"
      ).run(
        req.user.id,
        'ticket:' + ticket.id,
        req.ip,
        close === true ? 'closed' : 'answered'
      );
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.status ? error.message : 'Não foi possível responder.',
    });
  }
  res.json({ message: 'Resposta enviada.' });
});

router.get('/canned-replies', (req, res) => {
  require('../ops-desk').applySchema();
  res.json({
    replies: db
      .prepare('SELECT id, title, body FROM canned_replies ORDER BY id DESC LIMIT 100')
      .all(),
  });
});

router.get('/orders/lookup', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q || q.length > 200)
    return res.status(400).json({ error: 'Informe o pedido ou o link.' });
  const id = /^[1-9]\d{0,14}$/.test(q) ? Number(q) : 0;
  const like = '%' + q.replace(/[%_]/g, '') + '%';
  res.json({
    orders: db
      .prepare(
        `SELECT o.id, o.status, o.link, o.quantity, o.created_at, s.name AS service_name, u.email AS customer_email
         FROM orders o JOIN services s ON s.id=o.service_id JOIN users u ON u.id=o.user_id
         WHERE o.id=? OR o.link LIKE ?
         ORDER BY o.id DESC LIMIT 20`
      )
      .all(id, like),
  });
});

router.get('/orders/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0)
    return res.status(400).json({ error: 'Pedido inválido.' });
  const order = db
    .prepare(
      `SELECT o.id, o.uuid, o.status, o.link, o.quantity, o.start_count, o.remains,
              o.remote_order_id, o.is_dripfeed, o.created_at, o.updated_at,
              s.name AS service_name, s.platform, p.name AS provider_name, u.email AS customer_email
       FROM orders o
       JOIN services s ON s.id=o.service_id
       JOIN providers p ON p.id=o.provider_id
       JOIN users u ON u.id=o.user_id
       WHERE o.id=?`
    )
    .get(id);
  if (!order) return res.status(404).json({ error: 'Ordem não encontrada.' });
  order.refills = db
    .prepare(
      'SELECT id, status, batch_run, created_at, updated_at FROM order_refills WHERE order_id=? ORDER BY id DESC LIMIT 50'
    )
    .all(order.id);
  order.batches = db
    .prepare(
      'SELECT run, quantity, remains, status, due_at, completed_at FROM drip_batches WHERE order_id=? ORDER BY run'
    )
    .all(order.id);
  order.notes = db
    .prepare(
      `SELECT n.id, n.note, n.created_at, u.name AS author
       FROM order_staff_notes n LEFT JOIN users u ON u.id=n.admin_id
       WHERE n.order_id=? ORDER BY n.id`
    )
    .all(order.id);
  res.json({ order });
});

router.post('/orders/:id/notes', (req, res) => {
  const id = Number(req.params.id);
  const note = req.body && req.body.note;
  if (!Number.isSafeInteger(id) || id <= 0)
    return res.status(400).json({ error: 'Pedido inválido.' });
  if (typeof note !== 'string' || !note.trim() || note.length > 2000)
    return res.status(400).json({ error: 'Nota inválida.' });
  const order = db.prepare('SELECT id FROM orders WHERE id=?').get(id);
  if (!order) return res.status(404).json({ error: 'Ordem não encontrada.' });
  require('../ops-desk').applySchema();
  const inserted = db
    .prepare('INSERT INTO order_staff_notes(order_id, admin_id, note) VALUES(?,?,?)')
    .run(order.id, req.user.id, note.trim());
  res.status(201).json({ id: Number(inserted.lastInsertRowid) });
});

module.exports = router;
