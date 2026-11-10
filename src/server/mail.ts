import { createHash, randomBytes } from "node:crypto"
import { prisma } from "@/lib/db"
import { getSettings } from "@/server/settings"

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

export function newToken() {
  return randomBytes(24).toString("hex")
}

export async function queueMail(input: { userId?: string; to: string; subject: string; body: string }) {
  const settings = await getSettings()
  const row = await prisma.mailMessage.create({
    data: {
      userId: input.userId,
      to: input.to,
      subject: input.subject,
      body: input.body,
      status: "fila",
    },
  })
  const hook = settings.get("mail.webhook").trim()
  if (!hook || hook.includes("example.invalid")) {
    await prisma.mailMessage.update({ where: { id: row.id }, data: { status: "sem_destino" } })
    return row.id
  }
  try {
    const response = await fetch(hook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: input.to, subject: input.subject, text: input.body }),
    })
    await prisma.mailMessage.update({
      where: { id: row.id },
      data: { status: response.ok ? "enviado" : "falhou" },
    })
  } catch {
    await prisma.mailMessage.update({ where: { id: row.id }, data: { status: "falhou" } })
  }
  return row.id
}
