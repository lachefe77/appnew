import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/db"
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
  role: "cliente" | "admin"
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
      bankrolls: { create: { currency: safeCurrency, balanceCents: 0 } },
    },
  })
  return { ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } }
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
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  }
}
