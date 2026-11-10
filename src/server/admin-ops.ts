import { Prisma, type CouponType, type NoticeAudience, type OrderStatus } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { isOrderStatus } from "@/server/labels"
import { getSettings } from "@/server/settings"
import { SETTING_CATALOG } from "@/server/setting-catalog"

export type OpResult = { ok: true } | { ok: false; error: string }

type AuditInput = {
  actorId: string
  action: string
  entityType: string
  entityId?: string
  summary: string
  before?: unknown
  after?: unknown
}

async function audit(tx: Prisma.TransactionClient, input: AuditInput) {
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? "",
      summary: input.summary,
      ...(input.before !== undefined ? { before: input.before as Prisma.InputJsonValue } : {}),
      ...(input.after !== undefined ? { after: input.after as Prisma.InputJsonValue } : {}),
    },
  })
}

export async function updateUserProfile(
  actorId: string,
  userId: string,
  input: { name: string; email: string },
): Promise<OpResult> {
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Informe o nome." }
  if (!z.string().email().safeParse(email).success) return { ok: false, error: "E-mail inválido." }
  const current = await prisma.user.findUnique({ where: { id: userId } })
  if (!current) return { ok: false, error: "Usuário não encontrado." }
  const clash = await prisma.user.findFirst({ where: { email, NOT: { id: userId } } })
  if (clash) return { ok: false, error: "Esse e-mail já está em uso." }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { name, email } })
    await audit(tx, {
      actorId,
      action: "usuario.editar",
      entityType: "usuario",
      entityId: userId,
      summary: `Dados de ${current.email} atualizados.`,
      before: { name: current.name, email: current.email },
      after: { name, email },
    })
  })
  return { ok: true }
}

export async function banUser(actorId: string, userId: string, reason: string): Promise<OpResult> {
  const reasonText = reason.trim()
  if (reasonText.length < 3) return { ok: false, error: "Informe o motivo da suspensão." }
  if (actorId === userId) return { ok: false, error: "Você não pode suspender a própria conta." }
  const current = await prisma.user.findUnique({ where: { id: userId } })
  if (!current) return { ok: false, error: "Usuário não encontrado." }
  if (current.role === "admin") {
    return { ok: false, error: "Contas de administração não são suspensas por aqui." }
  }
  if (current.bannedAt) return { ok: false, error: "Esta conta já está suspensa." }
  const bannedAt = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { bannedAt, banReason: reasonText } })
    await audit(tx, {
      actorId,
      action: "usuario.banir",
      entityType: "usuario",
      entityId: userId,
      summary: `${current.email} suspenso. ${reasonText}`,
      after: { reason: reasonText },
    })
  })
  return { ok: true }
}

export async function unbanUser(actorId: string, userId: string): Promise<OpResult> {
  const current = await prisma.user.findUnique({ where: { id: userId } })
  if (!current) return { ok: false, error: "Usuário não encontrado." }
  if (!current.bannedAt) return { ok: false, error: "Esta conta não está suspensa." }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { bannedAt: null, banReason: null } })
    await audit(tx, {
      actorId,
      action: "usuario.desbanir",
      entityType: "usuario",
      entityId: userId,
      summary: `${current.email} voltou a poder entrar.`,
    })
  })
  return { ok: true }
}

export async function grantPlan(
  actorId: string,
  input: { userId: string; planId: string; days?: number | null },
): Promise<OpResult> {
  const user = await prisma.user.findUnique({ where: { id: input.userId } })
  if (!user) return { ok: false, error: "Usuário não encontrado." }
  const plan = await prisma.plan.findUnique({ where: { id: input.planId } })
  if (!plan || !plan.active) return { ok: false, error: "Escolha um plano ativo." }
  const settings = await getSettings()
  const requested = input.days && input.days > 0 ? Math.floor(input.days) : plan.durationDays || settings.num("plan.defaultDurationDays")
  if (requested < 1 || requested > 3650) {
    return { ok: false, error: "A duração precisa ficar entre 1 e 3650 dias." }
  }
  const startsAt = new Date()
  const endsAt = new Date(startsAt.getTime() + requested * 24 * 60 * 60 * 1000)
  await prisma.$transaction(async (tx) => {
    await tx.userPlan.updateMany({
      where: { userId: user.id, status: { in: ["ativo", "congelado"] } },
      data: { status: "removido" },
    })
    const grant = await tx.userPlan.create({
      data: {
        userId: user.id,
        planId: plan.id,
        status: "ativo",
        startsAt,
        endsAt,
        grantedById: actorId,
      },
    })
    await audit(tx, {
      actorId,
      action: "plano.conceder",
      entityType: "plano_usuario",
      entityId: grant.id,
      summary: `Plano ${plan.name} concedido a ${user.email} por ${requested} dias.`,
      after: { plan: plan.slug, days: requested, endsAt: endsAt.toISOString() },
    })
  })
  return { ok: true }
}

export async function removePlan(actorId: string, grantId: string): Promise<OpResult> {
  const grant = await prisma.userPlan.findUnique({
    where: { id: grantId },
    include: { user: true, plan: true },
  })
  if (!grant) return { ok: false, error: "Concessão não encontrada." }
  if (grant.status === "removido") return { ok: false, error: "Esse plano já foi removido." }
  await prisma.$transaction(async (tx) => {
    await tx.userPlan.update({ where: { id: grantId }, data: { status: "removido" } })
    await audit(tx, {
      actorId,
      action: "plano.remover",
      entityType: "plano_usuario",
      entityId: grantId,
      summary: `Plano ${grant.plan.name} removido de ${grant.user.email}.`,
    })
  })
  return { ok: true }
}

export async function freezePlan(actorId: string, grantId: string): Promise<OpResult> {
  const grant = await prisma.userPlan.findUnique({
    where: { id: grantId },
    include: { user: true, plan: true },
  })
  if (!grant) return { ok: false, error: "Concessão não encontrada." }
  if (grant.status !== "ativo") return { ok: false, error: "Só um plano ativo pode ser congelado." }
  const frozenAt = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.userPlan.update({ where: { id: grantId }, data: { status: "congelado", frozenAt } })
    await audit(tx, {
      actorId,
      action: "plano.congelar",
      entityType: "plano_usuario",
      entityId: grantId,
      summary: `Plano ${grant.plan.name} de ${grant.user.email} congelado.`,
    })
  })
  return { ok: true }
}

export async function unfreezePlan(actorId: string, grantId: string): Promise<OpResult> {
  const grant = await prisma.userPlan.findUnique({
    where: { id: grantId },
    include: { user: true, plan: true },
  })
  if (!grant) return { ok: false, error: "Concessão não encontrada." }
  if (grant.status !== "congelado") return { ok: false, error: "Esse plano não está congelado." }
  if (grant.endsAt.getTime() < Date.now()) {
    return { ok: false, error: "O prazo acabou. Conceda o plano de novo." }
  }
  await prisma.$transaction(async (tx) => {
    await tx.userPlan.update({ where: { id: grantId }, data: { status: "ativo", frozenAt: null } })
    await audit(tx, {
      actorId,
      action: "plano.descongelar",
      entityType: "plano_usuario",
      entityId: grantId,
      summary: `Plano ${grant.plan.name} de ${grant.user.email} descongelado.`,
    })
  })
  return { ok: true }
}

export async function createOrder(
  actorId: string,
  input: {
    userId: string
    planId: string
    status: string
    amountCents: number
    notes: string
    couponCode?: string
    affiliateCode?: string
  },
): Promise<OpResult> {
  if (!isOrderStatus(input.status)) return { ok: false, error: "Status de pedido inválido." }
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    return { ok: false, error: "Informe o valor do pedido." }
  }
  const notes = input.notes.trim()
  if (notes.length > 500) return { ok: false, error: "A nota do pedido ficou longa demais." }
  const user = await prisma.user.findUnique({ where: { id: input.userId } })
  if (!user) return { ok: false, error: "Usuário não encontrado." }
  const plan = await prisma.plan.findUnique({ where: { id: input.planId } })
  if (!plan) return { ok: false, error: "Plano não encontrado." }

  const couponCode = input.couponCode?.trim()
  const affiliateCode = input.affiliateCode?.trim()
  const coupon = couponCode
    ? await prisma.coupon.findFirst({ where: { code: { equals: couponCode, mode: "insensitive" } } })
    : null
  if (couponCode && !coupon) return { ok: false, error: "Cupom não encontrado." }
  if (coupon) {
    if (!coupon.active) return { ok: false, error: "Esse cupom está inativo." }
    if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
      return { ok: false, error: "Esse cupom venceu." }
    }
    if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
      return { ok: false, error: "Esse cupom esgotou." }
    }
  }
  const affiliate = affiliateCode
    ? await prisma.affiliate.findFirst({
        where: { code: { equals: affiliateCode, mode: "insensitive" }, active: true },
      })
    : null
  if (affiliateCode && !affiliate) return { ok: false, error: "Afiliado não encontrado." }

  const status = input.status as OrderStatus
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        userId: user.id,
        planId: plan.id,
        status,
        amountCents: input.amountCents,
        currency: plan.currency,
        notes,
        couponId: coupon?.id,
        affiliateId: affiliate?.id,
      },
    })
    if (coupon) {
      await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } })
    }
    await audit(tx, {
      actorId,
      action: "pedido.criar",
      entityType: "pedido",
      entityId: order.id,
      summary: `Pedido de ${user.email} registrado como ${status}.`,
      after: { amountCents: input.amountCents, status, plan: plan.slug },
    })
  })
  return { ok: true }
}

export async function updateOrder(
  actorId: string,
  orderId: string,
  input: { status: string; amountCents: number; notes: string },
): Promise<OpResult> {
  if (!isOrderStatus(input.status)) return { ok: false, error: "Status de pedido inválido." }
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    return { ok: false, error: "Informe o valor do pedido." }
  }
  const notes = input.notes.trim()
  if (notes.length > 500) return { ok: false, error: "A nota do pedido ficou longa demais." }
  const current = await prisma.order.findUnique({ where: { id: orderId }, include: { user: true } })
  if (!current) return { ok: false, error: "Pedido não encontrado." }
  const status = input.status as OrderStatus
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status, amountCents: input.amountCents, notes },
    })
    await audit(tx, {
      actorId,
      action: "pedido.editar",
      entityType: "pedido",
      entityId: orderId,
      summary: `Pedido de ${current.user.email} atualizado.`,
      before: { status: current.status, amountCents: current.amountCents, notes: current.notes },
      after: { status, amountCents: input.amountCents, notes },
    })
  })
  return { ok: true }
}

export async function createCoupon(
  actorId: string,
  input: {
    code: string
    type: string
    value: number
    maxUses: number | null
    expiresAt: Date | null
  },
): Promise<OpResult> {
  const code = input.code.trim().toUpperCase()
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) {
    return { ok: false, error: "O código do cupom usa de 3 a 20 letras, números, _ ou -." }
  }
  if (input.type !== "percentual" && input.type !== "valor") {
    return { ok: false, error: "Tipo de cupom inválido." }
  }
  if (!Number.isInteger(input.value) || input.value < 1) {
    return { ok: false, error: "Informe o valor do cupom." }
  }
  if (input.type === "percentual" && input.value > 100) {
    return { ok: false, error: "O percentual fica entre 1 e 100." }
  }
  if (input.maxUses != null && (!Number.isInteger(input.maxUses) || input.maxUses < 1)) {
    return { ok: false, error: "O limite de uso precisa ser um inteiro maior que zero." }
  }
  const clash = await prisma.coupon.findUnique({ where: { code } })
  if (clash) return { ok: false, error: "Já existe um cupom com esse código." }
  const type = input.type as CouponType
  await prisma.$transaction(async (tx) => {
    const coupon = await tx.coupon.create({
      data: {
        code,
        type,
        value: input.value,
        maxUses: input.maxUses,
        expiresAt: input.expiresAt,
      },
    })
    await audit(tx, {
      actorId,
      action: "cupom.criar",
      entityType: "cupom",
      entityId: coupon.id,
      summary: `Cupom ${code} criado.`,
      after: { type, value: input.value },
    })
  })
  return { ok: true }
}

export async function setCouponActive(actorId: string, couponId: string, active: boolean): Promise<OpResult> {
  const coupon = await prisma.coupon.findUnique({ where: { id: couponId } })
  if (!coupon) return { ok: false, error: "Cupom não encontrado." }
  await prisma.$transaction(async (tx) => {
    await tx.coupon.update({ where: { id: couponId }, data: { active } })
    await audit(tx, {
      actorId,
      action: active ? "cupom.ativar" : "cupom.desativar",
      entityType: "cupom",
      entityId: couponId,
      summary: `Cupom ${coupon.code} ${active ? "ativado" : "desativado"}.`,
    })
  })
  return { ok: true }
}

export async function createAffiliate(
  actorId: string,
  input: { code: string; name: string; commissionPercent: number },
): Promise<OpResult> {
  const code = input.code.trim().toUpperCase()
  const name = input.name.trim()
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) {
    return { ok: false, error: "O código do afiliado usa de 3 a 20 letras, números, _ ou -." }
  }
  if (name.length < 2) return { ok: false, error: "Informe o nome do afiliado." }
  if (!Number.isInteger(input.commissionPercent) || input.commissionPercent < 0 || input.commissionPercent > 100) {
    return { ok: false, error: "A comissão fica entre 0 e 100." }
  }
  const clash = await prisma.affiliate.findUnique({ where: { code } })
  if (clash) return { ok: false, error: "Já existe um afiliado com esse código." }
  await prisma.$transaction(async (tx) => {
    const affiliate = await tx.affiliate.create({
      data: { code, name, commissionPercent: input.commissionPercent },
    })
    await audit(tx, {
      actorId,
      action: "afiliado.criar",
      entityType: "afiliado",
      entityId: affiliate.id,
      summary: `Afiliado ${code} registrado com ${input.commissionPercent}% de comissão.`,
    })
  })
  return { ok: true }
}

export async function setAffiliateActive(actorId: string, affiliateId: string, active: boolean): Promise<OpResult> {
  const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId } })
  if (!affiliate) return { ok: false, error: "Afiliado não encontrado." }
  await prisma.$transaction(async (tx) => {
    await tx.affiliate.update({ where: { id: affiliateId }, data: { active } })
    await audit(tx, {
      actorId,
      action: active ? "afiliado.ativar" : "afiliado.desativar",
      entityType: "afiliado",
      entityId: affiliateId,
      summary: `Afiliado ${affiliate.code} ${active ? "ativado" : "desativado"}.`,
    })
  })
  return { ok: true }
}

export async function recordCommission(
  actorId: string,
  input: { affiliateId: string; amountCents: number; note: string; orderId?: string },
): Promise<OpResult> {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 1) {
    return { ok: false, error: "Informe o valor da comissão." }
  }
  const note = input.note.trim()
  if (note.length > 300) return { ok: false, error: "A nota da comissão ficou longa demais." }
  const affiliate = await prisma.affiliate.findUnique({ where: { id: input.affiliateId } })
  if (!affiliate) return { ok: false, error: "Afiliado não encontrado." }
  if (input.orderId) {
    const order = await prisma.order.findUnique({ where: { id: input.orderId } })
    if (!order) return { ok: false, error: "Pedido não encontrado." }
  }
  await prisma.$transaction(async (tx) => {
    const commission = await tx.affiliateCommission.create({
      data: {
        affiliateId: affiliate.id,
        amountCents: input.amountCents,
        note,
        orderId: input.orderId || null,
      },
    })
    await audit(tx, {
      actorId,
      action: "comissao.registrar",
      entityType: "comissao",
      entityId: commission.id,
      summary: `Comissão registrada para ${affiliate.code}.`,
      after: { amountCents: input.amountCents, orderId: input.orderId ?? null },
    })
  })
  return { ok: true }
}

export async function createNotice(
  actorId: string,
  input: { title: string; body: string; audience: string; publish: boolean },
): Promise<OpResult> {
  const title = input.title.trim()
  const body = input.body.trim()
  if (title.length < 3 || title.length > 120) return { ok: false, error: "Informe o título do aviso." }
  if (body.length < 3 || body.length > 2000) return { ok: false, error: "Informe o texto do aviso." }
  if (input.audience !== "todos" && input.audience !== "clientes" && input.audience !== "painel") {
    return { ok: false, error: "Público do aviso inválido." }
  }
  const audience = input.audience as NoticeAudience
  await prisma.$transaction(async (tx) => {
    const notice = await tx.notice.create({
      data: {
        title,
        body,
        audience,
        published: input.publish,
        publishedAt: input.publish ? new Date() : null,
        authorId: actorId,
      },
    })
    await audit(tx, {
      actorId,
      action: input.publish ? "aviso.publicar" : "aviso.criar",
      entityType: "aviso",
      entityId: notice.id,
      summary: input.publish ? `Aviso "${title}" publicado.` : `Aviso "${title}" guardado como rascunho.`,
    })
  })
  return { ok: true }
}

export async function setNoticePublished(actorId: string, noticeId: string, published: boolean): Promise<OpResult> {
  const notice = await prisma.notice.findUnique({ where: { id: noticeId } })
  if (!notice) return { ok: false, error: "Aviso não encontrado." }
  await prisma.$transaction(async (tx) => {
    await tx.notice.update({
      where: { id: noticeId },
      data: { published, publishedAt: published ? new Date() : null },
    })
    await audit(tx, {
      actorId,
      action: published ? "aviso.publicar" : "aviso.ocultar",
      entityType: "aviso",
      entityId: noticeId,
      summary: published ? `Aviso "${notice.title}" publicado.` : `Aviso "${notice.title}" ocultado.`,
    })
  })
  return { ok: true }
}

export async function saveSettings(
  actorId: string,
  group: string,
  entries: { key: string; value: string }[],
): Promise<OpResult> {
  const allowed = SETTING_CATALOG.filter((item) => item.group === group)
  if (!allowed.length) return { ok: false, error: "Grupo desconhecido." }
  const next: { key: string; value: string }[] = []
  for (const item of allowed) {
    const found = entries.find((entry) => entry.key === item.key)
    let value = (found?.value ?? "").trim()
    if (item.kind === "boolean") {
      if (value !== "true" && value !== "false") {
        return { ok: false, error: `Valor inválido em ${item.label}.` }
      }
      next.push({ key: item.key, value })
      continue
    }
    if (item.kind === "number") {
      if (!/^\d+$/.test(value)) return { ok: false, error: `${item.label} precisa ser um número inteiro.` }
      const numeric = Number(value)
      if (item.key === "plan.defaultDurationDays" && (numeric < 1 || numeric > 3650)) {
        return { ok: false, error: "A duração padrão fica entre 1 e 3650 dias." }
      }
      next.push({ key: item.key, value: String(numeric) })
      continue
    }
    if (item.key === "money.currency") value = value.toUpperCase()
    if (!value) return { ok: false, error: `Preencha ${item.label}.` }
    const limit = item.kind === "longtext" ? 600 : 160
    if (value.length > limit) return { ok: false, error: `${item.label} passou do limite.` }
    if (item.key === "money.currency" && !/^[A-Z]{3}$/.test(value)) {
      return { ok: false, error: "A moeda usa três letras, como BRL." }
    }
    next.push({ key: item.key, value })
  }
  const beforeRows = await prisma.setting.findMany({ where: { key: { in: next.map((item) => item.key) } } })
  await prisma.$transaction(async (tx) => {
    for (const item of allowed) {
      const value = next.find((entry) => entry.key === item.key)!.value
      await tx.setting.upsert({
        where: { key: item.key },
        update: { value, label: item.label, group: item.group, kind: item.kind },
        create: { key: item.key, value, label: item.label, group: item.group, kind: item.kind },
      })
    }
    await audit(tx, {
      actorId,
      action: group === "status" ? "status.alterar" : "configuracao.alterar",
      entityType: "configuracao",
      summary: group === "status" ? "Status do site atualizado." : "Textos e parâmetros atualizados.",
      before: Object.fromEntries(beforeRows.map((row) => [row.key, row.value])),
      after: Object.fromEntries(next.map((row) => [row.key, row.value])),
    })
  })
  return { ok: true }
}

export async function updatePlanCatalog(
  actorId: string,
  planId: string,
  input: { name: string; description: string; priceCents: number; durationDays: number; active: boolean },
): Promise<OpResult> {
  const name = input.name.trim()
  const description = input.description.trim()
  if (name.length < 2) return { ok: false, error: "Informe o nome do plano." }
  if (description.length < 2) return { ok: false, error: "Informe a descrição do plano." }
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0) {
    return { ok: false, error: "Informe o preço do plano." }
  }
  if (!Number.isInteger(input.durationDays) || input.durationDays < 1 || input.durationDays > 3650) {
    return { ok: false, error: "A duração do plano fica entre 1 e 3650 dias." }
  }
  const current = await prisma.plan.findUnique({ where: { id: planId } })
  if (!current) return { ok: false, error: "Plano não encontrado." }
  await prisma.$transaction(async (tx) => {
    await tx.plan.update({
      where: { id: planId },
      data: {
        name,
        description,
        priceCents: input.priceCents,
        durationDays: input.durationDays,
        active: input.active,
      },
    })
    await audit(tx, {
      actorId,
      action: "plano.editar",
      entityType: "plano",
      entityId: planId,
      summary: `Plano ${current.slug} atualizado.`,
      before: {
        name: current.name,
        priceCents: current.priceCents,
        durationDays: current.durationDays,
        active: current.active,
      },
      after: { name, priceCents: input.priceCents, durationDays: input.durationDays, active: input.active },
    })
  })
  return { ok: true }
}
