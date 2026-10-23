const { db } = require('./db');

/* 45. EVENT SOURCING — toda transição de order vira evento */

function recordEvent(orderId, eventType, payload = null) {
  db.prepare(`INSERT INTO order_events (order_id, event_type, payload_json) VALUES (?,?,?)`)
    .run(orderId, eventType, payload ? JSON.stringify(payload) : null);
}

function getEvents(orderId) {
  return db.prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY id ASC').all(orderId)
    .map(e => ({ ...e, payload: e.payload_json ? JSON.parse(e.payload_json) : null }));
}

function replayState(orderId) {
  const events = getEvents(orderId);
  const state = { id: orderId, status: null, history: [] };
  for (const e of events) {
    state.history.push({ type: e.event_type, at: e.created_at, data: e.payload });
    if (e.event_type.startsWith('status.')) state.status = e.event_type.replace('status.', '');
  }
  return state;
}

module.exports = { recordEvent, getEvents, replayState };
