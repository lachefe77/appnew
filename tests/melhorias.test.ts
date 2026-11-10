import { existsSync } from "node:fs"
import { afterAll, beforeEach, expect, it } from "vitest"
import { prisma } from "@/lib/db"
import { changeBankroll } from "@/server/bankroll"
import { loadSignals } from "@/server/feed"
import { marketFamily, matchKey, normalizeName } from "@/server/match"
import { expectedProfit, realizedProfit, startOfDay } from "@/server/sheet"
import { quoteProblem, roundHouseStake, stakeForTarget, stakesForMany } from "@/server/surebet"
import { totpCode, verifyTotp } from "@/server/totp"
import { resetDb } from "./reset"

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

const tabs = [
  "src/app/(site)/painel/page.tsx",
  "src/app/(site)/painel/operacoes/page.tsx",
  "src/app/(site)/painel/banca/page.tsx",
  "src/app/(site)/painel/planilhamento/page.tsx",
  "src/app/(site)/painel/stakes/page.tsx",
  "src/app/(site)/painel/calculadora/page.tsx",
  "src/app/(site)/painel/suporte/page.tsx",
  "src/app/(site)/painel/planos/page.tsx",
]

it("cada aba do painel existe", () => {
  for (const tab of tabs) expect(existsSync(tab)).toBe(true)
})

it("casa o mesmo jogo em casas diferentes e ignora odd real velha", async () => {
  const sport = await prisma.sport.create({ data: { slug: "futebol", name: "Futebol", imageUrl: "/esportes/futebol.svg" } })
  const pinnacle = await prisma.house.create({ data: { slug: "pinnacle", name: "Pinnacle.com", logoUrl: "/m.svg", feed: "ao_vivo", operable: true } })
  const cloudbet = await prisma.house.create({ data: { slug: "cloudbet", name: "Cloudbet", logoUrl: "/c.svg", feed: "ao_vivo", operable: true } })
  const starts = new Date("2026-11-12T20:00:00.000Z")
  await prisma.nameAlias.create({ data: { kind: "time", source: normalizeName("Flamengo RJ"), target: normalizeName("Flamengo") } })
  const home = await prisma.event.create({
    data: { sportId: sport.id, name: "Flamengo RJ x Palmeiras", phase: "prelive", externalId: "pin-1", startsAt: starts },
  })
  const away = await prisma.event.create({
    data: { sportId: sport.id, name: "Flamengo x Palmeiras", phase: "prelive", externalId: "cb-1", startsAt: starts, competition: "brasileirao" },
  })
  const stale = await prisma.event.create({
    data: { sportId: sport.id, name: "Santos x Vasco", phase: "prelive", externalId: "old", startsAt: starts },
  })
  await prisma.quote.createMany({
    data: [
      { eventId: home.id, houseId: pinnacle.id, market: "moneyline", side: "casa", odd: 2.1, phase: "prelive", source: "publico" },
      { eventId: away.id, houseId: cloudbet.id, market: "Resultado", side: "fora", odd: 2.1, phase: "prelive", source: "publico" },
      { eventId: stale.id, houseId: pinnacle.id, market: "Resultado", side: "casa", odd: 3, phase: "prelive", source: "publico", updatedAt: new Date("2020-01-01") },
      { eventId: stale.id, houseId: cloudbet.id, market: "Resultado", side: "fora", odd: 3, phase: "prelive", source: "publico", updatedAt: new Date("2020-01-01") },
    ],
  })
  const user = await prisma.user.create({
    data: { name: "Op", email: "op2@teste.local", passwordHash: "x", bankrolls: { create: { currency: "BRL", balanceCents: 100000 } } },
  })
  const loaded = await loadSignals({ userId: user.id, phase: "prelive", simulate: false, options: { sort: "lucro" } })
  expect(loaded.signals).toHaveLength(1)
  expect(loaded.signals[0]?.eventIds).toHaveLength(2)
  expect(loaded.signals[0]?.market).toBe("1x2")
  expect(marketFamily("moneyline")).toBe("1x2")
})

it("não casa jogos com horários distantes", () => {
  const aliases = new Map<string, string>()
  const early = matchKey({
    eventId: "a",
    sport: "Futebol",
    name: "A x B",
    startsAt: new Date("2026-11-12T12:00:00.000Z"),
    windowMinutes: 30,
    aliases,
  })
  const late = matchKey({
    eventId: "b",
    sport: "Futebol",
    name: "A x B",
    startsAt: new Date("2026-11-12T18:00:00.000Z"),
    windowMinutes: 30,
    aliases,
  })
  expect(early).not.toBe(late)
})

it("arredonda a stake, calcula 1x2 e trava odd que não fecha", () => {
  expect(roundHouseStake(1050, 100, 100, 500000)).toEqual({ rounded: 1100, leftoverCents: -50, limitNote: "" })
  expect(roundHouseStake(900000, 100, 100, 500000).limitNote).toContain("máxima")
  const three = stakesForMany(10000, [2.1, 3.6, 4.2])
  expect(three?.stakes.reduce((sum, stake) => sum + stake, 0)).toBe(10000)
  expect(quoteProblem([1.5, 1.5])).toContain("não fecham")
  expect(stakeForTarget(250, [2.05, 2.05])?.profitCents).toBeGreaterThan(0)
})

it("separa o lucro realizado do previsto e move a banca na moeda", async () => {
  const now = new Date()
  const rows = [
    { createdAt: now, settledAt: now, result: "ganhou", amountCents: 10000, profitCents: 250 },
    { createdAt: now, settledAt: null, result: "pendente", amountCents: 5000, profitCents: 100 },
  ]
  expect(realizedProfit(rows, startOfDay(now))).toBe(250)
  expect(expectedProfit(rows, startOfDay(now))).toBe(100)
  const user = await prisma.user.create({
    data: { name: "Op", email: "op3@teste.local", passwordHash: "x" },
  })
  const moved = await changeBankroll(user.id, 2000, "entrada", "Entrada", "USD")
  expect(moved.ok).toBe(true)
  const usd = await prisma.bankroll.findUnique({ where: { userId_currency: { userId: user.id, currency: "USD" } } })
  expect(usd?.balanceCents).toBe(2000)
  const audit = await prisma.auditLog.findFirst({ where: { action: "banca.entrada" } })
  expect(audit?.summary).toContain("USD")
})

it("confere o código TOTP do vetor conhecido", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
  expect(totpCode(secret, 1111111109 * 1000)).toBe("081804")
  expect(verifyTotp(secret, "081804", 1111111109 * 1000)).toBe(true)
})
