/**
 * ARENA ARCADE — Rate Limiting
 * HTTP: 60 req/min por IP
 * WS input: 180/s; signal: 600/min; command: 180/min por conexão
 * WS userId: 20 ações sensíveis/min por userId
 */

const httpWindows = new Map(); // ip     -> { count, resetAt }
const wsWindows = new Map(); // ws     -> { count, resetAt }
const userWindows = new Map(); // userId -> { count, resetAt }

const HTTP_LIMIT_PER_MIN = 60;

const SENSITIVE_TYPES = new Set([
  "WITHDRAW_PIX",
  "SEND_CHALLENGE",
  "LOGIN_ACCOUNT",
  "REGISTER_ACCOUNT",
  "DEPOSIT_PIX",
  "SPIN_LUCKY_WHEEL",
  "FIND_MATCH",
  "CREATE_ROOM_INVITE",
  "REMATCH_OFFER",
]);

// ── HTTP ──────────────────────────────────────────────────────────────────────
export function httpRateLimit(req, res, next) {
  const ip = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  let w = httpWindows.get(ip);
  if (!w || now > w.resetAt) {
    w = { count: 0, resetAt: now + 60000 };
    httpWindows.set(ip, w);
  }
  w.count++;
  if (w.count > HTTP_LIMIT_PER_MIN) {
    res.writeHead(429, {
      "Content-Type": "application/json",
      "Retry-After": "60",
    });
    res.end(JSON.stringify({ error: "Too many requests. Aguarde 1 minuto." }));
    return;
  }
  next();
}

// ── WS per-connection ─────────────────────────────────────────────────────────
export function wsRateLimit(ws, type) {
  const now = Date.now();
  const category = ["PLAYER_INPUT", "NETPLAY_FRAME"].includes(type)
    ? "input"
    : type === "MATCH_SIGNAL"
      ? "signal"
      : "command";
  let buckets = wsWindows.get(ws);
  if (!buckets) {
    buckets = new Map();
    wsWindows.set(ws, buckets);
  }
  let w = buckets.get(category);
  if (!w || now > w.resetAt) {
    w = { count: 0, resetAt: now + (category === "input" ? 1000 : 60000) };
    buckets.set(category, w);
  }
  w.count++;
  return (
    w.count <= (category === "input" ? 180 : category === "signal" ? 600 : 180)
  );
}

// ── WS per-userId (sensitive actions) ────────────────────────────────────────
export function wsUserRateLimit(userId, messageType) {
  if (!userId || !SENSITIVE_TYPES.has(messageType)) return true;
  const now = Date.now();
  let w = userWindows.get(userId);
  if (!w || now > w.resetAt) {
    w = { count: 0, resetAt: now + 60000 };
    userWindows.set(userId, w);
  }
  w.count++;
  return w.count <= 20; // 20 sensitive actions/min per userId
}

export function wsCleanup(ws) {
  wsWindows.delete(ws);
}

// Cleanup stale entries every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of httpWindows) {
    if (now > v.resetAt) httpWindows.delete(k);
  }
  for (const [k, buckets] of wsWindows) {
    for (const [name, v] of buckets) if (now > v.resetAt) buckets.delete(name);
    if (!buckets.size) wsWindows.delete(k);
  }
  for (const [k, v] of userWindows) {
    if (now > v.resetAt) userWindows.delete(k);
  }
}, 300000).unref();
