import { SignJWT, jwtVerify } from "jose"

export const SESSION_COOKIE = "fs_session"

export type SessionPayload = {
  sub: string
  role: "cliente" | "admin" | "moderador"
  email: string
  sv: number
}

function secret() {
  const value = process.env.AUTH_SECRET
  if (!value || value.length < 16) {
    throw new Error("Defina AUTH_SECRET com pelo menos 16 caracteres.")
  }
  return new TextEncoder().encode(value)
}

export async function signSession(session: SessionPayload) {
  return new SignJWT({ role: session.role, email: session.email, sv: session.sv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.sub)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret())
}

export async function signChallenge(userId: string) {
  return new SignJWT({ step: "totp" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret())
}

export async function verifyChallenge(token: string) {
  try {
    const { payload } = await jwtVerify(token, secret())
    if (payload.step !== "totp" || !payload.sub) return null
    return payload.sub
  } catch {
    return null
  }
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret())
    const role = payload.role
    const email = payload.email
    const sub = payload.sub
    const sv = typeof payload.sv === "number" ? payload.sv : 0
    if ((role !== "cliente" && role !== "admin" && role !== "moderador") || typeof email !== "string" || !sub) {
      return null
    }
    return { sub, role, email, sv }
  } catch {
    return null
  }
}
