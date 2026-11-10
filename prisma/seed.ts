import bcrypt from "bcryptjs"
import { PrismaClient } from "@prisma/client"
import { EVENT_SEED, HOUSE_SEED, OPERATOR_EMAIL, OPERATOR_PASSWORD, QUOTE_SEED, SPORT_SEED } from "../src/server/fixture-data"
import { SETTING_CATALOG } from "../src/server/setting-catalog"

const prisma = new PrismaClient()

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@futsurebet.com"
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "FutAdmin#2026"

const plans = [
  {
    slug: "semanal",
    name: "Semanal",
    description: "Sete dias com o painel de sinais liberado.",
    priceCents: 4900,
    durationDays: 7,
    sortOrder: 1,
  },
  {
    slug: "mensal",
    name: "Mensal",
    description: "Trinta dias com o painel de sinais liberado.",
    priceCents: 14900,
    durationDays: 30,
    sortOrder: 2,
  },
  {
    slug: "trimestral",
    name: "Trimestral",
    description: "Noventa dias com o painel de sinais liberado.",
    priceCents: 34900,
    durationDays: 90,
    sortOrder: 3,
  },
]

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL.toLowerCase() } })
  if (!existing) {
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10)
    await prisma.user.create({
      data: {
        name: "Administração Fut Surebet",
        email: ADMIN_EMAIL.toLowerCase(),
        passwordHash,
        role: "admin",
        emailVerifiedAt: new Date(),
      },
    })
    console.log(`Conta admin criada: ${ADMIN_EMAIL}`)
  } else {
    console.log(`Conta admin já existe: ${ADMIN_EMAIL}`)
  }

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { slug: plan.slug },
      update: {},
      create: { ...plan, currency: "BRL", active: true },
    })
  }

  for (const item of SETTING_CATALOG) {
    await prisma.setting.upsert({
      where: { key: item.key },
      update: { label: item.label, group: item.group, kind: item.kind },
      create: {
        key: item.key,
        label: item.label,
        group: item.group,
        kind: item.kind,
        value: item.defaultValue,
      },
    })
  }

  const houseIds = new Map<string, string>()
  for (const house of HOUSE_SEED) {
    const saved = await prisma.house.upsert({
      where: { slug: house.slug },
      update: {
        name: house.name,
        logoUrl: `/marcas/${house.slug}.svg`,
        cloneLabel: house.cloneLabel,
        operable: true,
        sortOrder: house.sortOrder,
        url: "url" in house ? house.url : "",
      },
      create: {
        slug: house.slug,
        name: house.name,
        url: "url" in house ? house.url : "",
        logoUrl: `/marcas/${house.slug}.svg`,
        currency: house.currency,
        cloneLabel: house.cloneLabel,
        operable: true,
        feed: "fixture",
        active: true,
        sortOrder: house.sortOrder,
      },
    })
    houseIds.set(house.slug, saved.id)
  }
  for (const house of HOUSE_SEED) {
    if (!house.cloneOf) continue
    await prisma.house.update({
      where: { slug: house.slug },
      data: { cloneOfId: houseIds.get(house.cloneOf) ?? null },
    })
  }

  const sportIds = new Map<string, string>()
  for (const sport of SPORT_SEED) {
    const saved = await prisma.sport.upsert({
      where: { slug: sport.slug },
      update: { name: sport.name, imageUrl: `/esportes/${sport.slug}.svg` },
      create: { slug: sport.slug, name: sport.name, imageUrl: `/esportes/${sport.slug}.svg` },
    })
    sportIds.set(sport.slug, saved.id)
  }

  const eventIds = new Map<string, string>()
  for (const event of EVENT_SEED) {
    const existingEvent = await prisma.event.findFirst({ where: { externalId: event.externalId } })
    const saved = existingEvent
      ? await prisma.event.update({
          where: { id: existingEvent.id },
          data: { name: event.name, phase: event.phase, sportId: sportIds.get(event.sport) ?? "" },
        })
      : await prisma.event.create({
          data: {
            externalId: event.externalId,
            name: event.name,
            phase: event.phase,
            sportId: sportIds.get(event.sport) ?? "",
            startsAt: new Date(),
          },
        })
    eventIds.set(event.externalId, saved.id)
  }

  for (const quote of QUOTE_SEED) {
    const eventId = eventIds.get(quote.event)
    const houseId = houseIds.get(quote.house)
    if (!eventId || !houseId) continue
    const houseRow = await prisma.house.findUnique({ where: { id: houseId } })
    if (houseRow?.feed === "ao_vivo") continue
    await prisma.quote.upsert({
      where: {
        eventId_houseId_market_side: {
          eventId,
          houseId,
          market: quote.market,
          side: quote.side,
        },
      },
      update: quote.event === "live-demo" ? { phase: quote.phase, source: "fixture" } : { odd: quote.odd, phase: quote.phase, source: "fixture" },
      create: {
        eventId,
        houseId,
        market: quote.market,
        side: quote.side,
        odd: quote.odd,
        phase: quote.phase,
        source: "fixture",
      },
    })
  }

  const operator = await prisma.user.findUnique({ where: { email: OPERATOR_EMAIL } })
  if (!operator) {
    const passwordHash = await bcrypt.hash(OPERATOR_PASSWORD, 10)
    const mensal = await prisma.plan.findUnique({ where: { slug: "mensal" } })
    const created = await prisma.user.create({
      data: {
        name: "Operador Fut Surebet",
        email: OPERATOR_EMAIL,
        passwordHash,
        role: "cliente",
        emailVerifiedAt: new Date(),
        bankrolls: { create: { currency: "BRL", balanceCents: 100000 } },
        plans: mensal
          ? {
              create: {
                planId: mensal.id,
                status: "ativo",
                startsAt: new Date(),
                endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              },
            }
          : undefined,
      },
    })
    console.log(`Conta operador criada: ${created.email}`)
  }
  await prisma.user.updateMany({
    where: { email: { in: [ADMIN_EMAIL.toLowerCase(), OPERATOR_EMAIL] }, emailVerifiedAt: null },
    data: { emailVerifiedAt: new Date() },
  })
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
