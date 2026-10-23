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
      'SELECT id,subject,status,priority,user_id FROM tickets WHERE id=?'
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
module.exports = router;
