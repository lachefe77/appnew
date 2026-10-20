/**
 * MFA admin (TOTP HMAC-SHA1, 30s) para settle/saque/role.
 * Sem MFA_ENFORCE=1 e sem secret: lab permite (dev). Com enforce, exige código.
 */
import crypto from "node:crypto";

const STEP = 30;

function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export function generateTotpSecret() {
  return crypto.randomBytes(20).toString("base64url");
}

export function totpAt(secret, atMs = Date.now()) {
  const key = Buffer.from(secret, "base64url");
  const counter = Math.floor(atMs / 1000 / STEP);
  return hotp(key, counter);
}

export function verifyTotp(secret, code, { atMs = Date.now(), window = 1 } = {}) {
  if (!secret || !/^\d{6}$/.test(String(code || ""))) return false;
  const key = Buffer.from(secret, "base64url");
  const counter = Math.floor(atMs / 1000 / STEP);
  for (let w = -window; w <= window; w++) {
    if (hotp(key, counter + w) === String(code)) return true;
  }
  return false;
}

/** Replay: códigos já usados no step atual são rejeitados. */
const used = new Map(); // `${userId}:${code}:${step}` → expiry

export function assertAdminMfa({
  userId,
  code,
  secret,
  enforce = process.env.MFA_ENFORCE === "1",
  atMs = Date.now(),
}) {
  if (!enforce) {
    // Lab: se há secret e código, valida; senão passa.
    if (!secret) return { ok: true, bypass: true };
    if (!code) return { ok: true, bypass: true };
  }
  if (!secret) {
    const err = new Error("MFA admin não configurado para esta conta.");
    err.status = 403;
    err.code = "MFA_REQUIRED";
    throw err;
  }
  if (!verifyTotp(secret, code, { atMs })) {
    const err = new Error("Código MFA inválido ou expirado.");
    err.status = 401;
    err.code = "MFA_INVALID";
    throw err;
  }
  const step = Math.floor(atMs / 1000 / STEP);
  const key = `${userId}:${code}:${step}`;
  if (used.has(key)) {
    const err = new Error("Código MFA já utilizado.");
    err.status = 401;
    err.code = "MFA_REPLAY";
    throw err;
  }
  used.set(key, atMs + STEP * 1000 * 2);
  // GC leve
  if (used.size > 5000) {
    const now = atMs;
    for (const [k, exp] of used) if (exp < now) used.delete(k);
  }
  return { ok: true, bypass: false };
}

export function clearMfaReplayForTests() {
  used.clear();
}
