"use server"

import { cookies } from "next/headers"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { signChallenge } from "@/lib/jwt"
import { clearSession, setSession } from "@/lib/session"
import {
  authenticate,
  changePassword,
  registerAccount,
  requestPasswordReset,
  resetPassword,
  sendEmailConfirmation,
} from "@/server/accounts"
import { verifyTotp } from "@/server/totp"
import { prisma } from "@/lib/db"

async function origin() {
  const headerList = await headers()
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost"
  const proto = headerList.get("x-forwarded-proto") ?? "http"
  return `${proto}://${host}`
}

function safeNext(value: string) {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return ""
  return value
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "")
  const password = String(formData.get("password") ?? "")
  const next = safeNext(String(formData.get("next") ?? ""))
  const result = await authenticate(email, password)
  if (!result.ok) {
    const params = new URLSearchParams({ erro: result.error })
    if (next) params.set("next", next)
    redirect(`/entrar?${params.toString()}`)
  }
  if (result.user.totpEnabled) {
    const token = await signChallenge(result.user.id)
    const jar = await cookies()
    jar.set("fs_totp", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 300,
    })
    redirect("/entrar/codigo")
  }
  await setSession({ sub: result.user.id, role: result.user.role, email: result.user.email, sv: result.user.sessionVersion })
  if (result.user.role === "admin") redirect(next.startsWith("/admin") ? next : "/admin")
  if (result.user.role === "moderador") redirect("/admin/suporte")
  redirect(next && !next.startsWith("/admin") ? next : "/painel")
}

export async function registerAction(formData: FormData) {
  const result = await registerAccount({
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirm: String(formData.get("confirm") ?? ""),
    referralCode: String(formData.get("referral") ?? ""),
  })
  if (!result.ok) {
    redirect(`/cadastro?erro=${encodeURIComponent(result.error)}`)
  }
  await sendEmailConfirmation(result.user.id, result.user.email, await origin())
  await setSession({ sub: result.user.id, role: result.user.role, email: result.user.email, sv: result.user.sessionVersion })
  redirect("/painel")
}

export async function recoverAction(formData: FormData) {
  await requestPasswordReset(String(formData.get("email") ?? ""), await origin())
  redirect("/recuperar?ok=1")
}

export async function resetPasswordAction(formData: FormData) {
  const token = String(formData.get("token") ?? "")
  const result = await resetPassword(token, String(formData.get("password") ?? ""))
  if (!result.ok) redirect(`/recuperar/${token}?erro=${encodeURIComponent(result.error)}`)
  redirect("/entrar?ok=Senha%20atualizada.%20Entre%20de%20novo.")
}

export async function changePasswordAction(formData: FormData) {
  const { getSession } = await import("@/lib/session")
  const session = await getSession()
  if (!session) redirect("/entrar")
  const result = await changePassword(session.sub, String(formData.get("current") ?? ""), String(formData.get("next") ?? ""))
  if (!result.ok) redirect(`/painel?erro=${encodeURIComponent(result.error)}`)
  await setSession({ sub: result.id, role: result.role, email: result.email, sv: result.sessionVersion })
  redirect("/painel?ok=Senha%20atualizada.%20As%20outras%20sessões%20foram%20encerradas.")
}

export async function totpAction(formData: FormData) {
  const jar = await cookies()
  const token = jar.get("fs_totp")?.value ?? ""
  const { verifyChallenge } = await import("@/lib/jwt")
  const userId = await verifyChallenge(token)
  if (!userId) redirect("/entrar?erro=O%20código%20expirou.%20Entre%20de%20novo.")
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || !user.totpEnabled || !verifyTotp(user.totpSecret, String(formData.get("code") ?? ""))) {
    redirect("/entrar/codigo?erro=Código%20inválido.")
  }
  jar.delete("fs_totp")
  await setSession({ sub: user.id, role: user.role, email: user.email, sv: user.sessionVersion })
  redirect(user.role === "moderador" ? "/admin/suporte" : "/admin")
}

export async function logoutAction() {
  await clearSession()
  redirect("/")
}
