import { prisma } from "@/lib/db"
import { getSettings } from "@/server/settings"

export type GrantSnapshot = {
  status: "ativo" | "congelado" | "removido" | "expirado"
  startsAt: Date
  endsAt: Date
}

export type PanelReason =
  | "sem_plano"
  | "congelado"
  | "removido"
  | "expirado"
  | "painel_desligado"
  | "banido"
  | "manutencao"

export type PanelDecision = { open: true } | { open: false; reason: PanelReason }

export function decidePanelAccess(input: {
  banned: boolean
  siteOnline: boolean
  signalsVisible: boolean
  now: Date
  grants: GrantSnapshot[]
}): PanelDecision {
  if (input.banned) return { open: false, reason: "banido" }
  if (!input.siteOnline) return { open: false, reason: "manutencao" }
  if (!input.signalsVisible) return { open: false, reason: "painel_desligado" }

  const active = input.grants.some(
    (grant) => grant.status === "ativo" && grant.startsAt <= input.now && grant.endsAt >= input.now,
  )
  if (active) return { open: true }

  if (input.grants.some((grant) => grant.status === "congelado")) {
    return { open: false, reason: "congelado" }
  }
  const expired =
    input.grants.some((grant) => grant.status === "expirado") ||
    input.grants.some((grant) => grant.status === "ativo" && grant.endsAt < input.now)
  if (expired) return { open: false, reason: "expirado" }
  if (input.grants.some((grant) => grant.status === "removido")) {
    return { open: false, reason: "removido" }
  }
  return { open: false, reason: "sem_plano" }
}

export async function expireElapsedGrants(now = new Date()) {
  await prisma.userPlan.updateMany({
    where: { status: "ativo", endsAt: { lt: now } },
    data: { status: "expirado" },
  })
}

export async function loadPanelGate(userId: string, now = new Date()): Promise<PanelDecision> {
  await expireElapsedGrants(now)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { plans: true },
  })
  if (!user) return { open: false, reason: "sem_plano" }
  const settings = await getSettings()
  return decidePanelAccess({
    banned: user.bannedAt != null,
    siteOnline: settings.flag("site.online"),
    signalsVisible: settings.flag("site.signalsVisible"),
    now,
    grants: user.plans.map((plan) => ({
      status: plan.status,
      startsAt: plan.startsAt,
      endsAt: plan.endsAt,
    })),
  })
}
