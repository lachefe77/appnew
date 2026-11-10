import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { hashToken, newToken, queueMail } from "@/server/mail"
import { getSettings } from "@/server/settings"

export const BANNED_MESSAGE = "Esta conta está suspensa."

const registerSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(80, "O nome ficou longo demais."),
  email: z.string().trim().email("E-mail inválido.").max(160),
  password: z.string().min(8, "A senha precisa de 8 caracteres.").max(72, "A senha ficou longa demais."),
})

export type AuthUser = {
  id: string
  email: string
  name: string
  role: "cliente" | "admin" | "moderador"
  sessionVersion: number
  totpEnabled: boolean
}

export type AuthResult = { ok: true; user: AuthUser } | { ok: false; error: string }

function rounds() {
  const value = Number(process.env.BCRYPT_ROUNDS ?? 10)
  return Number.isInteger(value) && value >= 4 && value <= 14 ? value : 10
}

export async function registerAccount(input: {
  name: string
  email: string
  password: string
  confirm?: string
  referralCode?: string
}): Promise<AuthResult> {
  const settings = await getSettings()
  if (!settings.flag("site.registrationOpen")) {
    return { ok: false, error: settings.get("auth.registerClosed") }
  }
  if (input.confirm !== undefined && input.confirm !== input.password) {
    return { ok: false, error: "A confirmação da senha não confere." }
  }
  const parsed = registerSchema.safeParse({
    name: input.name,
    email: input.email,
    password: input.password,
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Não foi possível criar a conta." }
  }
  const email = parsed.data.email.toLowerCase()
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return { ok: false, error: "Já existe uma conta com esse e-mail." }

  let referredByCode: string | undefined
  const referral = input.referralCode?.trim()
  if (referral) {
    const affiliate = await prisma.affiliate.findFirst({
      where: { code: { equals: referral, mode: "insensitive" }, active: true },
    })
    if (!affiliate) return { ok: false, error: "Código de indicação não encontrado." }
    referredByCode = affiliate.code
  }

  const currency = settings.get("money.currency").toUpperCase()
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : "BRL"
  const passwordHash = await bcrypt.hash(parsed.data.password, rounds())
  const user = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email,
      passwordHash,
      referredByCode,
      bankrolls: {
        create: [...new Set([safeCurrency, "BRL", "USD", "EUR"])].map((currency) => ({ currency, balanceCents: 0 })),
      },
    },
  })
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      sessionVersion: user.sessionVersion,
      totpEnabled: user.totpEnabled,
    },
  }
}

export async function authenticate(email: string, password: string): Promise<AuthResult> {
  const normalized = email.trim().toLowerCase()
  const user = await prisma.user.findUnique({ where: { email: normalized } })
  if (!user) return { ok: false, error: "E-mail ou senha incorretos." }
  const matches = await bcrypt.compare(password, user.passwordHash)
  if (!matches) return { ok: false, error: "E-mail ou senha incorretos." }
  if (user.bannedAt) return { ok: false, error: BANNED_MESSAGE }
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      sessionVersion: user.sessionVersion,
      totpEnabled: user.totpEnabled,
    },
  }
}

const DAY = 24 * 60 * 60 * 1000

export async function sendEmailConfirmation(userId: string, email: string, origin: string) {
  const token = newToken()
  await prisma.emailConfirm.create({
    data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + DAY) },
  })
  await queueMail({
    userId,
    to: email,
    subject: "Confirme seu e-mail na Fut Surebet",
    body: `Abra este endereço para confirmar a conta: ${origin}/confirmar/${token}`,
  })
}

export async function confirmEmail(token: string) {
  const row = await prisma.emailConfirm.findUnique({ where: { tokenHash: hashToken(token) } })
  if (!row || row.usedAt || row.expiresAt < new Date()) return { ok: false as const, error: "Esse link não vale mais." }
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } }),
    prisma.emailConfirm.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ])
  return { ok: true as const }
}

export async function requestPasswordReset(email: string, origin: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } })
  if (!user || user.bannedAt) return { ok: true as const }
  const token = newToken()
  await prisma.passwordReset.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  })
  await queueMail({
    userId: user.id,
    to: user.email,
    subject: "Recuperar senha da Fut Surebet",
    body: `Abra este endereço para escolher outra senha: ${origin}/recuperar/${token}`,
  })
  return { ok: true as const }
}

export async function resetPassword(token: string, password: string) {
  if (password.length < 8) return { ok: false as const, error: "A senha precisa de 8 caracteres." }
  const row = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) } })
  if (!row || row.usedAt || row.expiresAt < new Date()) return { ok: false as const, error: "Esse link não vale mais." }
  const passwordHash = await bcrypt.hash(password, rounds())
  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    }),
    prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ])
  return { ok: true as const }
}

export async function changePassword(userId: string, current: string, next: string) {
  if (next.length < 8) return { ok: false as const, error: "A senha precisa de 8 caracteres." }
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return { ok: false as const, error: "Conta não encontrada." }
  const matches = await bcrypt.compare(current, user.passwordHash)
  if (!matches) return { ok: false as const, error: "A senha atual não confere." }
  const passwordHash = await bcrypt.hash(next, rounds())
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, sessionVersion: { increment: 1 } },
  })
  return { ok: true as const, sessionVersion: updated.sessionVersion, email: updated.email, role: updated.role, id: updated.id }
}
