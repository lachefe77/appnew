import { SignJWT, jwtVerify } from "jose"

export const SESSION_COOKIE = "fs_session"

export type SessionPayload = {
  sub: string
  role: "cliente" | "admin"
  email: string
}

function secret() {
  const value = process.env.AUTH_SECRET
  if (!value || value.length < 16) {
    throw new Error("Defina AUTH_SECRET com pelo menos 16 caracteres.")
  }
  return new TextEncoder().encode(value)
}

export async function signSession(session: SessionPayload) {
  return new SignJWT({ role: session.role, email: session.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.sub)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret())
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret())
    const role = payload.role
    const email = payload.email
    const sub = payload.sub
    if ((role !== "cliente" && role !== "admin") || typeof email !== "string" || !sub) {
      return null
    }
    return { sub, role, email }
  } catch {
    return null
  }
}
