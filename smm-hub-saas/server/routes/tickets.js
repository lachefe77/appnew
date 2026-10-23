const express = require('express');
const { db, tx } = require('../db');
const { requireAuth } = require('../auth');
const { sendMail } = require('../mail');

const router = express.Router();
router.use(requireAuth);

const { attachToMessage } = require('../ticket-attachments');

function enrichMessages(ticketId) {
  const messages = db
    .prepare(
      `
    SELECT m.id, m.is_staff, m.message, m.created_at, u.name as sender_name
    FROM ticket_messages m JOIN users u ON m.user_id = u.id
    WHERE m.ticket_id = ? ORDER BY m.id ASC
  `
    )
    .all(ticketId);
  for (const m of messages) {
    m.attachments = db
      .prepare(
        `SELECT id, filename, mime_type, size_bytes FROM ticket_attachments WHERE message_id = ?`
      )
      .all(m.id);
  }
  return messages;
}

router.post('/', (req, res) => {
  const { subject, order_id, message, priority, attachments } = req.body;
  if (
    order_id &&
    !db
      .prepare('SELECT id FROM orders WHERE id=? AND user_id=?')
      .get(order_id, req.user.id)
  )
    return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (
    typeof subject !== 'string' ||
    !subject.trim() ||
    subject.length > 200 ||
    typeof message !== 'string' ||
    !message.trim() ||
    message.length > 10000 ||
    (priority && !['low', 'medium', 'high', 'urgent'].includes(priority))
  )
    return res
      .status(400)
      .json({ error: 'Assunto, mensagem ou prioridade inválidos.' });

  let ticketId;
  try {
    ticketId = tx(() => {
      const result = db
        .prepare(
          `
    INSERT INTO tickets (user_id, order_id, subject, status, priority)
    VALUES (?, ?, ?, 'open', ?)
  `
        )
        .run(
          req.user.id,
          order_id || null,
          subject.trim(),
          priority || 'medium'
        );

      const ticketId = result.lastInsertRowid;
      const msg = db
        .prepare(
          `INSERT INTO ticket_messages (ticket_id, user_id, is_staff, message) VALUES (?, ?, 0, ?)`
        )
        .run(ticketId, req.user.id, message.trim());
      attachToMessage(msg.lastInsertRowid, attachments);
      return ticketId;
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.status ? error.message : 'Não foi possível abrir o chamado.',
    });
  }

  res.status(201).json({ message: 'Ticket aberto!', ticket_id: ticketId });
});

router.get('/', (req, res) => {
  const tickets = db
    .prepare(
      `
    SELECT t.id, t.order_id, t.subject, t.status, t.priority, t.created_at, t.updated_at,
           COUNT(m.id) as message_count
    FROM tickets t
    LEFT JOIN ticket_messages m ON t.id = m.ticket_id
    WHERE t.user_id = ?
    GROUP BY t.id
    ORDER BY t.id DESC
  `
    )
    .all(req.user.id);
  res.json({ tickets });
});

router.get('/:id', (req, res) => {
  const ticket = db
    .prepare('SELECT * FROM tickets WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado.' });
  res.json({ ticket, messages: enrichMessages(ticket.id) });
});

/* Baixa anexo individual */
router.get('/attachment/:id', (req, res) => {
  const att = db
    .prepare(
      `SELECT a.* FROM ticket_attachments a
    JOIN ticket_messages m ON a.message_id = m.id
    JOIN tickets t ON m.ticket_id = t.id
    WHERE a.id = ? AND (t.user_id = ? OR ? = 1)`
    )
    .get(
      req.params.id,
      req.user.id,
      ['support', 'admin', 'ceo'].includes(req.user.role) ? 1 : 0
    );
  if (!att) return res.status(404).send('Anexo não encontrado.');
  res.setHeader('Content-Type', att.mime_type);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${att.filename.replace(/[^a-zA-Z0-9_.-]/g, '_')}"`
  );
  res.send(Buffer.from(att.data_base64, 'base64'));
});

router.post('/:id/reply', (req, res) => {
  const { message, attachments } = req.body;
  if (typeof message !== 'string' || !message.trim() || message.length > 10000)
    return res.status(400).json({ error: 'Mensagem inválida.' });

  const ticket = db
    .prepare('SELECT * FROM tickets WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado.' });

  try {
    tx(() => {
      const msg = db
        .prepare(
          `INSERT INTO ticket_messages (ticket_id, user_id, is_staff, message) VALUES (?, ?, 0, ?)`
        )
        .run(ticket.id, req.user.id, message.trim());
      attachToMessage(msg.lastInsertRowid, attachments);
      db.prepare(
        `UPDATE tickets SET status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(ticket.id);
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.status ? error.message : 'Não foi possível responder.',
    });
  }
  res.json({ message: 'Resposta enviada.' });
});

router.post('/:id/close', (req, res) => {
  const ticket = db
    .prepare('SELECT id FROM tickets WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado.' });
  db.prepare(
    `UPDATE tickets SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(ticket.id);
  res.json({ message: 'Ticket encerrado.' });
});

module.exports = router;
