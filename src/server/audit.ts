import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"

export async function recordAudit(input: {
  actorId?: string | null
  action: string
  entityType: string
  entityId?: string
  summary: string
  before?: unknown
  after?: unknown
}) {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId || null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? "",
      summary: input.summary,
      ...(input.before !== undefined ? { before: input.before as Prisma.InputJsonValue } : {}),
      ...(input.after !== undefined ? { after: input.after as Prisma.InputJsonValue } : {}),
    },
  })
}
