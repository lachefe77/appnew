import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { SESSION_COOKIE, signSession, verifySession, type SessionPayload } from "@/lib/jwt"

const WEEK = 60 * 60 * 24 * 7

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null
  const session = await verifySession(token)
  if (!session) return null
  const user = await prisma.user.findUnique({ where: { id: session.sub } })
  if (!user || user.bannedAt || user.sessionVersion !== session.sv) {
    await clearSession()
    return null
  }
  return { sub: user.id, role: user.role, email: user.email, sv: user.sessionVersion }
}

export async function setSession(session: SessionPayload) {
  const token = await signSession(session)
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WEEK,
  })
}

export async function clearSession() {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
}

export async function requireAdmin() {
  const user = await requireStaff()
  if (user.role !== "admin") redirect("/admin/suporte")
  return user
}

export async function requireStaff() {
  const session = await getSession()
  if (!session) redirect("/entrar?next=/admin")
  const user = await prisma.user.findUnique({ where: { id: session.sub } })
  if (!user || user.bannedAt) redirect("/api/sessao/encerrar")
  if (user.role !== "admin" && user.role !== "moderador") redirect("/painel")
  return user
}
