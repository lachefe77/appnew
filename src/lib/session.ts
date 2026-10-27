import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "nh_session";

export type SessionRole = "ADMIN" | "OPERATOR" | "RESELLER" | "CUSTOMER";

export type SessionPayload = {
  sub: string;
  role: SessionRole;
  email: string;
};

function secret() {
  const value = process.env.AUTH_SECRET ?? "";
  if (value.length < 16) throw new Error("AUTH_SECRET ausente");
  return new TextEncoder().encode(value);
}

export async function signSession(input: { id: string; role: SessionRole; email: string }) {
  return new SignJWT({ role: input.role, email: input.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.id)
    .setIssuedAt()
    .setExpirationTime("14d")
    .sign(secret());
}

export async function readSession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const role = payload.role;
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
    if (role !== "ADMIN" && role !== "OPERATOR" && role !== "RESELLER" && role !== "CUSTOMER") return null;
    return { sub: payload.sub, role, email: payload.email };
  } catch {
    return null;
  }
}

export function safeNext(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return value;
}
