import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacSha256(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function safeEqual(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function publicCode() {
  return `NH-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export function newId(prefix: string) {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}
