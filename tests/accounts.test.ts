import { afterAll, beforeEach, expect, it } from "vitest"
import { prisma } from "@/lib/db"
import { BANNED_MESSAGE, authenticate, registerAccount } from "@/server/accounts"
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
  unfreezePlan,
  updateOrder,
} from "@/server/admin-ops"
import { loadPanelGate } from "@/server/panel-access"
import { SETTING_CATALOG } from "@/server/setting-catalog"
import { getSettings } from "@/server/settings"
import { resetDb } from "./reset"

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

it("cadastra, entra, libera, congela, remove e suspende", async () => {
  const plan = await prisma.plan.create({
    data: {
      slug: "mensal",
      name: "Mensal",
      description: "Trinta dias",
      priceCents: 14900,
      durationDays: 30,
    },
  })
  const admin = await prisma.user.create({
    data: {
      name: "Admin Teste",
      email: "admin@teste.local",
      passwordHash: "nao-usada",
      role: "admin",
    },
  })

  const registered = await registerAccount({
    name: "Ana Lima",
    email: "ana@teste.local",
    password: "senha-forte",
  })
  expect(registered.ok).toBe(true)
  if (!registered.ok) return

  const bankroll = await prisma.bankroll.findFirst({ where: { userId: registered.user.id } })
  expect(bankroll?.balanceCents).toBe(0)

  const login = await authenticate("ana@teste.local", "senha-forte")
  expect(login.ok).toBe(true)

  const wrong = await authenticate("ana@teste.local", "outra-senha")
  expect(wrong).toEqual({ ok: false, error: "E-mail ou senha incorretos." })

  expect(await loadPanelGate(registered.user.id)).toEqual({ open: false, reason: "sem_plano" })

  expect(await grantPlan(admin.id, { userId: registered.user.id, planId: plan.id })).toEqual({ ok: true })
  expect(await loadPanelGate(registered.user.id)).toEqual({ open: true })

  const grant = await prisma.userPlan.findFirstOrThrow({
    where: { userId: registered.user.id, status: "ativo" },
  })
  expect(await freezePlan(admin.id, grant.id)).toEqual({ ok: true })
  expect(await loadPanelGate(registered.user.id)).toEqual({ open: false, reason: "congelado" })

  expect(await unfreezePlan(admin.id, grant.id)).toEqual({ ok: true })
  expect(await loadPanelGate(registered.user.id)).toEqual({ open: true })

  expect(await removePlan(admin.id, grant.id)).toEqual({ ok: true })
  expect(await loadPanelGate(registered.user.id)).toEqual({ open: false, reason: "removido" })

  expect(await banUser(admin.id, registered.user.id, "abuso de teste")).toEqual({ ok: true })
  expect(await authenticate("ana@teste.local", "senha-forte")).toEqual({ ok: false, error: BANNED_MESSAGE })
  expect(await loadPanelGate(registered.user.id)).toEqual({ open: false, reason: "banido" })

  const actions = (await prisma.auditLog.findMany()).map((entry) => entry.action)
  expect(actions).toEqual(
    expect.arrayContaining(["plano.conceder", "plano.congelar", "plano.descongelar", "plano.remover", "usuario.banir"]),
  )
})

it("não duplica e-mail e respeita cadastro fechado", async () => {
  const first = await registerAccount({ name: "Bia Costa", email: "bia@teste.local", password: "senha-forte" })
  expect(first.ok).toBe(true)
  const second = await registerAccount({ name: "Bia Costa", email: "bia@teste.local", password: "senha-forte" })
  expect(second).toEqual({ ok: false, error: "Já existe uma conta com esse e-mail." })

  await prisma.setting.create({
    data: {
      key: "site.registrationOpen",
      label: "Cadastro",
      group: "status",
      kind: "boolean",
      value: "false",
    },
  })
  const closed = await registerAccount({ name: "Caio Dias", email: "caio@teste.local", password: "senha-forte" })
  expect(closed.ok).toBe(false)
})

it("registra pedido, cupom, afiliado, comissão e aviso", async () => {
  const admin = await prisma.user.create({
    data: { name: "Admin", email: "admin3@teste.local", passwordHash: "x", role: "admin" },
  })
  const registered = await registerAccount({ name: "Eva Luz", email: "eva@teste.local", password: "senha-forte" })
  if (!registered.ok) throw new Error(registered.error)
  const plan = await prisma.plan.create({
    data: { slug: "mensal", name: "Mensal", description: "Trinta dias", priceCents: 14900, durationDays: 30 },
  })

  expect(
    await createOrder(admin.id, {
      userId: registered.user.id,
      planId: plan.id,
      status: "pendente",
      amountCents: 14900,
      notes: "pedido manual",
    }),
  ).toEqual({ ok: true })
  const order = await prisma.order.findFirstOrThrow()
  expect(
    await updateOrder(admin.id, order.id, { status: "pago", amountCents: 9900, notes: "ajustado" }),
  ).toEqual({ ok: true })
  expect(
    await createCoupon(admin.id, { code: "casa10", type: "percentual", value: 10, maxUses: 5, expiresAt: null }),
  ).toEqual({ ok: true })
  expect(await createAffiliate(admin.id, { code: "TIME", name: "Time Fut", commissionPercent: 15 })).toEqual({
    ok: true,
  })
  const affiliate = await prisma.affiliate.findFirstOrThrow()
  expect(
    await recordCommission(admin.id, {
      affiliateId: affiliate.id,
      amountCents: 2500,
      note: "primeira",
      orderId: order.id,
    }),
  ).toEqual({ ok: true })
  expect(
    await createNotice(admin.id, {
      title: "Janela",
      body: "A grade abre com o plano.",
      audience: "todos",
      publish: true,
    }),
  ).toEqual({ ok: true })

  const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
  expect(saved.status).toBe("pago")
  expect(saved.amountCents).toBe(9900)
  expect(await prisma.coupon.count()).toBe(1)
  expect(await prisma.affiliateCommission.count()).toBe(1)
  expect((await prisma.notice.findFirstOrThrow()).published).toBe(true)
})

it("grava texto e fecha o painel pelo status", async () => {
  const plan = await prisma.plan.create({
    data: { slug: "semanal", name: "Semanal", description: "Sete dias", priceCents: 4900, durationDays: 7 },
  })
  const admin = await prisma.user.create({
    data: { name: "Admin", email: "admin2@teste.local", passwordHash: "x", role: "admin" },
  })
  const registered = await registerAccount({ name: "Duda Reis", email: "duda@teste.local", password: "senha-forte" })
  if (!registered.ok) throw new Error(registered.error)
  await grantPlan(admin.id, { userId: registered.user.id, planId: plan.id })

  const texts = SETTING_CATALOG.filter((item) => item.group === "textos").map((item) => ({
    key: item.key,
    value: item.key === "panel.lockedBody" ? "Texto novo da casa" : item.defaultValue,
  }))
  expect(await saveSettings(admin.id, "textos", texts)).toEqual({ ok: true })
  expect((await getSettings()).get("panel.lockedBody")).toBe("Texto novo da casa")

  expect(
    await saveSettings(admin.id, "status", [
      { key: "site.online", value: "true" },
      { key: "site.registrationOpen", value: "true" },
      { key: "site.signalsVisible", value: "false" },
      { key: "site.noticesVisible", value: "true" },
    ]),
  ).toEqual({ ok: true })
  expect(await loadPanelGate(registered.user.id)).toEqual({ open: false, reason: "painel_desligado" })
})
