function up(db) {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_order_progress_fairness ON orders(status,updated_at,id);
 CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id,id);
 CREATE INDEX IF NOT EXISTS idx_tickets_user_updated ON tickets(user_id,updated_at);
 CREATE INDEX IF NOT EXISTS idx_refills_status_updated ON order_refills(status,updated_at);
 CREATE INDEX IF NOT EXISTS idx_identity_user_kind_created ON identity_tokens(user_id,kind,created_at);
 CREATE INDEX IF NOT EXISTS idx_resets_user_expiry ON password_resets(user_id,expires_at);
 CREATE INDEX IF NOT EXISTS idx_order_review_service ON orders(service_id,id);
 CREATE INDEX IF NOT EXISTS idx_coupon_uses_user ON coupon_uses(coupon_id,user_id);`);
}
module.exports = { up };
