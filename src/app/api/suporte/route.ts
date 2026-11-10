import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getSession } from "@/lib/session"
import { getSettings } from "@/server/settings"

async function notesFor(userId: string) {
  const rows = await prisma.supportMessage.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { author: true },
    take: 200,
  })
  const user = await prisma.user.findUnique({ where: { id: userId } })
  return {
    status: user?.supportStatus ?? "aberto",
    notes: rows.map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      author: row.author.name,
      mine: row.authorId === userId,
    })),
  }
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Entre de novo." }, { status: 401 })
  return NextResponse.json(await notesFor(session.sub))
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Entre de novo." }, { status: 401 })
  const body = String(((await request.json().catch(() => ({}))) as { body?: string }).body ?? "").trim()
  if (body.length < 2) return NextResponse.json({ error: "Escreva a mensagem." }, { status: 400 })
  const settings = await getSettings()
  const cap = Number(settings.get("support.maxPerMinute").replace(",", "."))
  const max = Number.isFinite(cap) && cap > 0 ? cap : 6
  const recent = await prisma.supportMessage.count({
    where: { authorId: session.sub, createdAt: { gte: new Date(Date.now() - 60_000) } },
  })
  if (recent >= max) return NextResponse.json({ error: "Espere um minuto para enviar outra mensagem." }, { status: 429 })
  await prisma.supportMessage.create({
    data: { userId: session.sub, authorId: session.sub, body: body.slice(0, 2000) },
  })
  await prisma.user.update({
    where: { id: session.sub },
    data: { supportUnread: true, supportStatus: "aberto" },
  })
  return NextResponse.json(await notesFor(session.sub))
}
