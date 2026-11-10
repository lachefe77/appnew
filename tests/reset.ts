import { prisma } from "@/lib/db"

const testDatabase = "futsurebet_test"

export async function resetDb() {
  const url = process.env.DATABASE_URL ?? ""
  if (!url.includes(testDatabase)) {
    throw new Error(`Testes recusados fora do banco ${testDatabase}.`)
  }
  await prisma.alertDispatch.deleteMany()
  await prisma.stakeLaunch.deleteMany()
  await prisma.supportTicket.deleteMany()
  await prisma.quote.deleteMany()
  await prisma.affiliateCommission.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.notice.deleteMany()
  await prisma.bankrollEntry.deleteMany()
  await prisma.bankroll.deleteMany()
  await prisma.order.deleteMany()
  await prisma.userPlan.deleteMany()
  await prisma.coupon.deleteMany()
  await prisma.affiliate.deleteMany()
  await prisma.signal.deleteMany()
  await prisma.event.deleteMany()
  await prisma.sport.deleteMany()
  await prisma.house.updateMany({ data: { cloneOfId: null } })
  await prisma.house.deleteMany()
  await prisma.user.deleteMany()
  await prisma.plan.deleteMany()
  await prisma.setting.deleteMany()
}
