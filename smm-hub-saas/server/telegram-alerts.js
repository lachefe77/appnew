const config = require('./config');
const logger = require('./logger');

async function sendAlert(message, { level = 'info' } = {}) {
  if (!config.telegram.botToken || !config.telegram.alertChatId) {
    logger.debug({ message, level }, 'Telegram alert skipped (sem config)');
    return;
  }
  const emoji = { critical: '🚨', warning: '⚠️', info: 'ℹ️', success: '✅' }[level] || '📢';
  const text = `${emoji} *SMM Hub* — ${message}`;
  try {
    const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.telegram.alertChatId, text, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(5000)
    });
    if (!r.ok) logger.warn({ status: r.status }, 'Telegram alert HTTP não-OK');
  } catch (err) {
    logger.error({ err: err.message }, 'Falha enviando alerta Telegram');
  }
}

function startWatchdog(db) {
  // A cada 5 min: alertas de saldo upstream baixo e tickets high priority sem resposta
  setInterval(async () => {
    try {
      const low = db.prepare('SELECT name, balance_upstream FROM providers WHERE is_mock = 0 AND balance_upstream < 50').all();
      for (const p of low) {
        sendAlert(`Saldo upstream baixo em *${p.name}*: $${p.balance_upstream.toFixed(2)}`, { level: 'warning' });
      }
      const stuckTickets = db.prepare(`SELECT COUNT(*) as c FROM tickets WHERE status='open' AND priority='high'
        AND updated_at < datetime('now','-1 hour')`).get().c;
      if (stuckTickets > 0) sendAlert(`${stuckTickets} ticket(s) alta prioridade sem resposta > 1h`, { level: 'warning' });
    } catch (err) { logger.error({ err: err.message }, 'Watchdog falhou'); }
  }, 5 * 60 * 1000);
}

module.exports = { sendAlert, startWatchdog };
