"use server"

import { redirect } from "next/navigation"
import { clearSession, setSession } from "@/lib/session"
import { authenticate, registerAccount } from "@/server/accounts"

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
  await setSession({ sub: result.user.id, role: result.user.role, email: result.user.email })
  if (result.user.role === "admin") {
    redirect(next.startsWith("/admin") ? next : "/admin")
  }
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
  await setSession({ sub: result.user.id, role: result.user.role, email: result.user.email })
  redirect("/painel")
}

export async function logoutAction() {
  await clearSession()
  redirect("/")
}
