import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeEach, expect, it } from "vitest"
import { prisma } from "@/lib/db"
import { dispatchAlerts } from "@/server/alerts"
import { launchStake } from "@/server/bankroll"
import { loadSignals } from "@/server/feed"
import { buildSignals } from "@/server/surebet"
import { resetDb } from "./reset"

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

it("monta a grade, lança o stake uma vez e avisa o canal", async () => {
  const sport = await prisma.sport.create({ data: { slug: "futebol", name: "Futebol", imageUrl: "/esportes/futebol.svg" } })
  const pinnacle = await prisma.house.create({
    data: { slug: "pinnacle", name: "Pinnacle.com", currency: "EUR", logoUrl: "/marcas/pinnacle.svg", feed: "fixture", operable: true },
  })
  const stake = await prisma.house.create({
    data: { slug: "stake", name: "Stake.com", currency: "USD", logoUrl: "/marcas/stake.svg", feed: "fixture", operable: true },
  })
  const low = await prisma.event.create({
    data: { sportId: sport.id, name: "Flamengo x Palmeiras", phase: "prelive", externalId: "fut-classico" },
  })
  const highEvent = await prisma.event.create({
    data: { sportId: sport.id, name: "Lakers x Celtics", phase: "prelive", externalId: "nba-classico" },
  })
  await prisma.quote.createMany({
    data: [
      { eventId: low.id, houseId: pinnacle.id, market: "Resultado", side: "casa", odd: 2.05, phase: "prelive", source: "fixture" },
      { eventId: low.id, houseId: stake.id, market: "Resultado", side: "fora", odd: 2.05, phase: "prelive", source: "fixture" },
      { eventId: highEvent.id, houseId: pinnacle.id, market: "Resultado", side: "casa", odd: 2.16, phase: "prelive", source: "fixture" },
      { eventId: highEvent.id, houseId: stake.id, market: "Resultado", side: "fora", odd: 2.16, phase: "prelive", source: "fixture" },
    ],
  })
  const user = await prisma.user.create({
    data: {
      name: "Operador",
      email: "op@teste.local",
      passwordHash: "x",
      bankrolls: { create: { currency: "BRL", balanceCents: 100000 } },
    },
  })

  const loaded = await loadSignals({
    userId: user.id,
    phase: "prelive",
    simulate: false,
    options: { includedHouseIds: [pinnacle.id, stake.id], sort: "alfa" },
  })
  expect(loaded.totalStakeCents).toBe(10000)
  expect(loaded.signals.map((signal) => Number(signal.profitPercent.toFixed(2))).sort()).toEqual([2.5, 8])
  const high = loaded.signals.find((signal) => signal.highlight)
  const mild = loaded.signals.find((signal) => !signal.highlight)
  expect(high?.profitCents).toBe(800)
  expect(mild?.leg1.stakeCents).toBe(5000)
  expect(mild?.leg2.stakeCents).toBe(5000)
  expect(mild?.leg1.logoUrl).toContain("/marcas/")
  expect(mild?.sportImage).toContain("/esportes/")

  const first = await launchStake({
    userId: user.id,
    signalKey: mild!.key,
    amountCents: mild!.totalStakeCents,
    profitCents: mild!.profitCents,
    note: "teste",
  })
  expect(first).toMatchObject({ ok: true, duplicate: false, balanceCents: 90000 })
  const second = await launchStake({
    userId: user.id,
    signalKey: mild!.key,
    amountCents: mild!.totalStakeCents,
    profitCents: mild!.profitCents,
    note: "teste",
  })
  expect(second).toMatchObject({ ok: true, duplicate: true, balanceCents: 90000 })
  expect(await prisma.bankrollEntry.count({ where: { kind: "stake" } })).toBe(1)

  const hits: string[] = []
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    hits.push(Buffer.concat(chunks).toString("utf8"))
    response.writeHead(204)
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const port = (server.address() as AddressInfo).port
  await prisma.setting.createMany({
    data: [
      { key: "alert.channel", label: "Canal", group: "parametros", kind: "text", value: "discord" },
      { key: "alert.discordWebhook", label: "Webhook", group: "parametros", kind: "longtext", value: `http://127.0.0.1:${port}/hook` },
      { key: "alert.minProfit", label: "Piso", group: "parametros", kind: "text", value: "1" },
    ],
  })
  const sent = await dispatchAlerts(loaded.signals)
  const again = await dispatchAlerts(loaded.signals)
  await new Promise((resolve) => server.close(resolve))
  expect(sent).toHaveLength(2)
  expect(again).toHaveLength(0)
  expect(hits).toHaveLength(2)
  expect(hits.join(" ")).toContain("Fut Surebet")
  expect(await prisma.alertDispatch.count()).toBe(2)
})

it("não usa o motor para inventar par da mesma casa", () => {
  const signals = buildSignals(
    [
      {
        eventId: "jogo",
        eventName: "Jogo",
        sportName: "Futebol",
        sportImage: "",
        phase: "prelive",
        market: "Resultado",
        houseId: "sozinha",
        houseName: "Stake.com",
        houseSlug: "stake",
        logoUrl: "",
        currency: "BRL",
        cloneLabel: "",
        feed: "fixture",
        side: "casa",
        odd: 2.2,
      },
      {
        eventId: "jogo",
        eventName: "Jogo",
        sportName: "Futebol",
        sportImage: "",
        phase: "prelive",
        market: "Resultado",
        houseId: "sozinha",
        houseName: "Stake.com",
        houseSlug: "stake",
        logoUrl: "",
        currency: "BRL",
        cloneLabel: "",
        feed: "fixture",
        side: "fora",
        odd: 2.2,
      },
    ],
    { totalStakeCents: 1000, rates: { USD: 5.4, EUR: 6.2 } },
  )
  expect(signals).toHaveLength(0)
})
