/**
 * ARENA ARCADE — Rate Limiting
 * HTTP: 120 req/min por IP
 * WS input (partida): 600/s — não bloquear teclas/gamepad em duelo
 * WS signal: 900/min; command: 300/min por conexão
 * WS userId: 40 ações sensíveis/min (exceto input de partida)
 */

const httpWindows = new Map();
const wsWindows = new Map();
const userWindows = new Map();

const HTTP_LIMIT_PER_MIN = 120;

/** Tipos que nunca contam no bucket de comando/user (tráfego de partida). */
const MATCH_TRAFFIC = new Set([
  "PLAYER_INPUT",
  "NETPLAY_FRAME",
  "MATCH_SIGNAL",
  "INPUT_ACK",
  "PING",
  "PONG",
  "LATENCY_SAMPLE",
]);

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
  "SPECTATE_JOIN",
]);

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

export function wsRateLimit(ws, type) {
  if (MATCH_TRAFFIC.has(type)) {
    // Bucket dedicado generoso — duelo em 60 fps + gamepad polling.
    const now = Date.now();
    let buckets = wsWindows.get(ws);
    if (!buckets) {
      buckets = new Map();
      wsWindows.set(ws, buckets);
    }
    let w = buckets.get("input");
    if (!w || now > w.resetAt) {
      w = { count: 0, resetAt: now + 1000 };
      buckets.set("input", w);
    }
    w.count++;
    return w.count <= 600;
  }
  const now = Date.now();
  const category = type === "MATCH_SIGNAL" ? "signal" : "command";
  let buckets = wsWindows.get(ws);
  if (!buckets) {
    buckets = new Map();
    wsWindows.set(ws, buckets);
  }
  let w = buckets.get(category);
  if (!w || now > w.resetAt) {
    w = { count: 0, resetAt: now + 60000 };
    buckets.set(category, w);
  }
  w.count++;
  return w.count <= (category === "signal" ? 900 : 300);
}

export function wsUserRateLimit(userId, messageType) {
  if (!userId || !SENSITIVE_TYPES.has(messageType)) return true;
  if (MATCH_TRAFFIC.has(messageType)) return true;
  const now = Date.now();
  let w = userWindows.get(userId);
  if (!w || now > w.resetAt) {
    w = { count: 0, resetAt: now + 60000 };
    userWindows.set(userId, w);
  }
  w.count++;
  return w.count <= 40;
}

export function wsCleanup(ws) {
  wsWindows.delete(ws);
}

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
