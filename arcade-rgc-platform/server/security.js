/**
 * Controles de acesso administrativos e bloqueio de autenticação.
 * Sessões de usuário continuam em db.js (Sessions); não há token paralelo em memória.
 */

function parseAllowlist(raw = process.env.ADMIN_IP_ALLOWLIST || "") {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Compara IPv4 simples e prefixos CIDR /8–/32. IPv6 só em igualdade exata. */
export function ipMatches(clientIp, entry) {
  if (!clientIp || !entry) return false;
  const ip = clientIp.replace(/^::ffff:/, "");
  if (entry.includes("/")) {
    const [base, bitsStr] = entry.split("/");
    const bits = Number(bitsStr);
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(base))
      return false;
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const toInt = (v) =>
      v.split(".").reduce((n, o) => (n << 8) + (Number(o) & 255), 0) >>> 0;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (toInt(ip) & mask) === (toInt(base) & mask);
  }
  return ip === entry.replace(/^::ffff:/, "");
}

export function clientIpFromReq(req) {
  const raw =
    req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "";
  return String(raw).replace(/^::ffff:/, "");
}

export function assertAdminIpAllowed(req) {
  const allow = parseAllowlist();
  if (!allow.length) return;
  const ip = clientIpFromReq(req);
  if (!allow.some((entry) => ipMatches(ip, entry))) {
    const err = new Error("Acesso administrativo bloqueado para este IP.");
    err.status = 403;
    throw err;
  }
}

const authFailures = new Map(); // key -> { count, lockedUntil, resetAt }
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_FAILURES = 8;
const AUTH_LOCK_MS = 15 * 60 * 1000;

export function authLockKey(ip, identity = "") {
  return `${ip || "unknown"}|${String(identity).toLowerCase()}`;
}

export function assertAuthNotLocked(key) {
  const now = Date.now();
  const row = authFailures.get(key);
  if (row?.lockedUntil && now < row.lockedUntil) {
    const err = new Error(
      "Muitas tentativas de autenticação. Aguarde alguns minutos.",
    );
    err.status = 429;
    throw err;
  }
}

export function recordAuthFailure(key) {
  const now = Date.now();
  let row = authFailures.get(key);
  if (!row || now > row.resetAt) {
    row = { count: 0, lockedUntil: 0, resetAt: now + AUTH_WINDOW_MS };
  }
  row.count += 1;
  if (row.count >= AUTH_MAX_FAILURES) {
    row.lockedUntil = now + AUTH_LOCK_MS;
    row.count = 0;
    row.resetAt = row.lockedUntil;
  }
  authFailures.set(key, row);
  return row;
}

export function clearAuthFailures(key) {
  authFailures.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of authFailures) {
    if (now > (v.lockedUntil || 0) && now > v.resetAt) authFailures.delete(k);
  }
}, 300000).unref();
