"use server"

import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { requireAdmin, requireStaff } from "@/lib/session"
import { recordAudit } from "@/server/audit"
import { centsFromInput, daysFromInput } from "@/server/parse"
import {
  banUser,
  createAffiliate,
  createCoupon,
  createNotice,
  createOrder,
  freezePlan,
  grantPlan,
  recordCommission,
  removePlan,
  saveSettings,
  setAffiliateActive,
  setCouponActive,
  setNoticePublished,
  unbanUser,
  closeTicket,
  unfreezePlan,
  updateHouse,
  updateOrder,
  updatePlanCatalog,
  updateUserProfile,
  type OpResult,
} from "@/server/admin-ops"
import { SETTING_CATALOG } from "@/server/setting-catalog"

function reaisToCents(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? "").replace(",", "."))
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.round(parsed * 100)
}

function bounce(result: OpResult, path: string): never {
  if (!result.ok) redirect(`${path}?erro=${encodeURIComponent(result.error)}`)
  redirect(`${path}?ok=1`)
}

export async function saveUserAction(formData: FormData) {
  const admin = await requireAdmin()
  const userId = String(formData.get("userId") ?? "")
  const result = await updateUserProfile(admin.id, userId, {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
  })
  bounce(result, `/admin/usuarios/${userId}`)
}

export async function banUserAction(formData: FormData) {
  const admin = await requireAdmin()
  const userId = String(formData.get("userId") ?? "")
  const result = await banUser(admin.id, userId, String(formData.get("reason") ?? ""))
  bounce(result, `/admin/usuarios/${userId}`)
}

export async function unbanUserAction(formData: FormData) {
  const admin = await requireAdmin()
  const userId = String(formData.get("userId") ?? "")
  const result = await unbanUser(admin.id, userId)
  bounce(result, `/admin/usuarios/${userId}`)
}

export async function grantPlanAction(formData: FormData) {
  const admin = await requireAdmin()
  const userId = String(formData.get("userId") ?? "")
  const days = daysFromInput(String(formData.get("days") ?? ""))
  if (days === "invalid") bounce({ ok: false, error: "A duração precisa ser um número inteiro." }, `/admin/usuarios/${userId}`)
  const result = await grantPlan(admin.id, {
    userId,
    planId: String(formData.get("planId") ?? ""),
    days,
  })
  bounce(result, `/admin/usuarios/${userId}`)
}

export async function freezePlanAction(formData: FormData) {
  const admin = await requireAdmin()
  const userId = String(formData.get("userId") ?? "")
  const result = await freezePlan(admin.id, String(formData.get("grantId") ?? ""))
  bounce(result, `/admin/usuarios/${userId}`)
}

export async function unfreezePlanAction(formData: FormData) {
  const admin = await requireAdmin()
  const userId = String(formData.get("userId") ?? "")
  const result = await unfreezePlan(admin.id, String(formData.get("grantId") ?? ""))
  bounce(result, `/admin/usuarios/${userId}`)
}

export async function removePlanAction(formData: FormData) {
  const admin = await requireAdmin()
  const userId = String(formData.get("userId") ?? "")
  const result = await removePlan(admin.id, String(formData.get("grantId") ?? ""))
  bounce(result, `/admin/usuarios/${userId}`)
}

export async function createOrderAction(formData: FormData) {
  const admin = await requireAdmin()
  const amount = centsFromInput(String(formData.get("amount") ?? ""))
  if (amount == null) bounce({ ok: false, error: "Informe o valor do pedido." }, "/admin/vendas")
  const result = await createOrder(admin.id, {
    userId: String(formData.get("userId") ?? ""),
    planId: String(formData.get("planId") ?? ""),
    status: String(formData.get("status") ?? ""),
    amountCents: amount,
    notes: String(formData.get("notes") ?? ""),
    couponCode: String(formData.get("coupon") ?? ""),
    affiliateCode: String(formData.get("affiliate") ?? ""),
  })
  bounce(result, "/admin/vendas")
}

export async function updateOrderAction(formData: FormData) {
  const admin = await requireAdmin()
  const orderId = String(formData.get("orderId") ?? "")
  const amount = centsFromInput(String(formData.get("amount") ?? ""))
  if (amount == null) {
    bounce({ ok: false, error: "Informe o valor do pedido." }, `/admin/vendas?pedido=${orderId}`)
  }
  const result = await updateOrder(admin.id, orderId, {
    status: String(formData.get("status") ?? ""),
    amountCents: amount,
    notes: String(formData.get("notes") ?? ""),
  })
  bounce(result, "/admin/vendas")
}

export async function createCouponAction(formData: FormData) {
  const admin = await requireAdmin()
  const type = String(formData.get("type") ?? "")
  const maxRaw = String(formData.get("maxUses") ?? "").trim()
  const maxUses = maxRaw ? Number(maxRaw) : null
  if (maxRaw && !/^\d+$/.test(maxRaw)) {
    bounce({ ok: false, error: "O limite de uso precisa ser um inteiro." }, "/admin/afiliados")
  }
  const expiresRaw = String(formData.get("expiresAt") ?? "").trim()
  const expiresAt = expiresRaw ? new Date(expiresRaw) : null
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    bounce({ ok: false, error: "A data de validade é inválida." }, "/admin/afiliados")
  }
  let value = 0
  if (type === "percentual") {
    value = Number(String(formData.get("percent") ?? ""))
  } else {
    const cents = centsFromInput(String(formData.get("amount") ?? ""))
    if (cents == null) bounce({ ok: false, error: "Informe o valor do cupom." }, "/admin/afiliados")
    value = cents
  }
  const result = await createCoupon(admin.id, {
    code: String(formData.get("code") ?? ""),
    type,
    value,
    maxUses,
    expiresAt,
  })
  bounce(result, "/admin/afiliados")
}

export async function toggleCouponAction(formData: FormData) {
  const admin = await requireAdmin()
  const result = await setCouponActive(
    admin.id,
    String(formData.get("couponId") ?? ""),
    String(formData.get("active") ?? "") === "true",
  )
  bounce(result, "/admin/afiliados")
}

export async function createAffiliateAction(formData: FormData) {
  const admin = await requireAdmin()
  const percent = Number(String(formData.get("percent") ?? ""))
  const result = await createAffiliate(admin.id, {
    code: String(formData.get("code") ?? ""),
    name: String(formData.get("name") ?? ""),
    commissionPercent: percent,
  })
  bounce(result, "/admin/afiliados")
}

export async function toggleAffiliateAction(formData: FormData) {
  const admin = await requireAdmin()
  const result = await setAffiliateActive(
    admin.id,
    String(formData.get("affiliateId") ?? ""),
    String(formData.get("active") ?? "") === "true",
  )
  bounce(result, "/admin/afiliados")
}

export async function recordCommissionAction(formData: FormData) {
  const admin = await requireAdmin()
  const amount = centsFromInput(String(formData.get("amount") ?? ""))
  if (amount == null) bounce({ ok: false, error: "Informe o valor da comissão." }, "/admin/afiliados")
  const orderId = String(formData.get("orderId") ?? "")
  const result = await recordCommission(admin.id, {
    affiliateId: String(formData.get("affiliateId") ?? ""),
    amountCents: amount,
    note: String(formData.get("note") ?? ""),
    orderId,
  })
  bounce(result, "/admin/afiliados")
}

export async function createNoticeAction(formData: FormData) {
  const admin = await requireAdmin()
  const result = await createNotice(admin.id, {
    title: String(formData.get("title") ?? ""),
    body: String(formData.get("body") ?? ""),
    audience: String(formData.get("audience") ?? ""),
    publish: formData.get("publish") === "true",
  })
  bounce(result, "/admin/avisos")
}

export async function toggleNoticeAction(formData: FormData) {
  const admin = await requireAdmin()
  const result = await setNoticePublished(
    admin.id,
    String(formData.get("noticeId") ?? ""),
    String(formData.get("published") ?? "") === "true",
  )
  bounce(result, "/admin/avisos")
}

export async function saveSettingsAction(formData: FormData) {
  const admin = await requireAdmin()
  const group = String(formData.get("group") ?? "")
  const items = SETTING_CATALOG.filter((item) => item.group === group)
  const entries = items.map((item) => {
    if (item.kind === "boolean") {
      return { key: item.key, value: formData.get(item.key) === "true" ? "true" : "false" }
    }
    return { key: item.key, value: String(formData.get(item.key) ?? "") }
  })
  const result = await saveSettings(admin.id, group, entries)
  const path = group === "status" ? "/admin/status" : "/admin/configuracao"
  bounce(result, path)
}

export async function updatePlanAction(formData: FormData) {
  const admin = await requireAdmin()
  const planId = String(formData.get("planId") ?? "")
  const price = centsFromInput(String(formData.get("price") ?? ""))
  const days = daysFromInput(String(formData.get("days") ?? ""))
  if (price == null) bounce({ ok: false, error: "Informe o preço do plano." }, "/admin/planos")
  if (days == null || days === "invalid") {
    bounce({ ok: false, error: "Informe a duração do plano em dias." }, "/admin/planos")
  }
  const result = await updatePlanCatalog(admin.id, planId, {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    priceCents: price,
    durationDays: days,
    active: formData.get("active") === "true",
  })
  bounce(result, "/admin/planos")
}

export async function updateHouseAction(formData: FormData) {
  const admin = await requireAdmin()
  const result = await updateHouse(admin.id, String(formData.get("houseId") ?? ""), {
    currency: String(formData.get("currency") ?? ""),
    active: formData.get("active") === "true",
    fixedSide: String(formData.get("fixedSide") ?? ""),
    stakeStepCents: reaisToCents(formData.get("step")),
    minStakeCents: reaisToCents(formData.get("min")),
    maxStakeCents: reaisToCents(formData.get("max")),
  })
  bounce(result, "/admin/casas")
}

export async function closeTicketAction(formData: FormData) {
  const admin = await requireAdmin()
  const result = await closeTicket(admin.id, String(formData.get("ticketId") ?? ""))
  bounce(result, "/admin/suporte")
}

export async function replySupportAction(formData: FormData) {
  const admin = await requireStaff()
  const userId = String(formData.get("userId") ?? "")
  const body = String(formData.get("body") ?? "").trim()
  if (body.length < 2) redirect("/admin/suporte?erro=Escreva%20a%20resposta.")
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) redirect("/admin/suporte?erro=Cliente%20não%20encontrado.")
  await prisma.supportMessage.create({ data: { userId, authorId: admin.id, body: body.slice(0, 2000) } })
  await prisma.user.update({ where: { id: userId }, data: { supportUnread: false } })
  await recordAudit({
    actorId: admin.id,
    action: "suporte.responder",
    entityType: "suporte",
    entityId: userId,
    summary: `Resposta para ${user.email}.`,
  })
  redirect("/admin/suporte?ok=1")
}

export async function resolveSupportAction(formData: FormData) {
  const admin = await requireStaff()
  const userId = String(formData.get("userId") ?? "")
  await prisma.user.update({ where: { id: userId }, data: { supportStatus: "resolvido", supportUnread: false } })
  await recordAudit({
    actorId: admin.id,
    action: "suporte.resolver",
    entityType: "suporte",
    entityId: userId,
    summary: "Conversa marcada como resolvida.",
  })
  redirect("/admin/suporte?ok=1")
}

export async function testAlertAction() {
  const { sendTestAlert } = await import("@/server/alerts")
  const admin = await requireAdmin()
  const result = await sendTestAlert()
  await recordAudit({
    actorId: admin.id,
    action: "alerta.teste",
    entityType: "alerta",
    summary: result.ok ? result.detail : result.error,
  })
  if (!result.ok) redirect(`/admin/status?erro=${encodeURIComponent(result.error)}`)
  redirect(`/admin/status?ok=${encodeURIComponent(result.detail)}`)
}
