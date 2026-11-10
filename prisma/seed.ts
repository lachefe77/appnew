import bcrypt from "bcryptjs"
import { PrismaClient } from "@prisma/client"
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
