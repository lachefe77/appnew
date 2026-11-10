import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getSession } from "@/lib/session"
import { getSettings } from "@/server/settings"

async function notesFor(userId: string, conversationId: string) {
  const [rows, conversation] = await Promise.all([
    prisma.supportMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      include: { author: true },
      take: 200,
    }),
    prisma.supportConversation.findFirst({ where: { id: conversationId, userId } }),
  ])
  return {
    status: conversation?.status ?? "aberto",
    subject: conversation?.subject ?? "",
    notes: rows.map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      author: row.author.name,
      mine: row.authorId === userId,
    })),
  }
}

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Entre de novo." }, { status: 401 })
  const conversationId = new URL(request.url).searchParams.get("conversa") ?? ""
  const conversation = await prisma.supportConversation.findFirst({
    where: { id: conversationId, userId: session.sub },
  })
  if (!conversation) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 })
  return NextResponse.json(await notesFor(session.sub, conversation.id))
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Entre de novo." }, { status: 401 })
  const payload = (await request.json().catch(() => ({}))) as { body?: string; conversationId?: string; subject?: string }
  const body = String(payload.body ?? "").trim()
  if (body.length < 2) return NextResponse.json({ error: "Escreva a mensagem." }, { status: 400 })
  const settings = await getSettings()
  const cap = Number(settings.get("support.maxPerMinute").replace(",", "."))
  const max = Number.isFinite(cap) && cap > 0 ? cap : 6
  const recent = await prisma.supportMessage.count({
    where: { authorId: session.sub, createdAt: { gte: new Date(Date.now() - 60_000) } },
  })
  if (recent >= max) return NextResponse.json({ error: "Espere um minuto para enviar outra mensagem." }, { status: 429 })

  let conversationId = String(payload.conversationId ?? "")
  if (!conversationId) {
    const subject = String(payload.subject ?? "").trim()
    if (subject.length < 2) return NextResponse.json({ error: "Dê um assunto à conversa." }, { status: 400 })
    const created = await prisma.supportConversation.create({
      data: { userId: session.sub, subject: subject.slice(0, 80), unread: true },
    })
    conversationId = created.id
  }
  const conversation = await prisma.supportConversation.findFirst({
    where: { id: conversationId, userId: session.sub },
  })
  if (!conversation) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 })
  await prisma.supportMessage.create({
    data: { userId: session.sub, authorId: session.sub, conversationId, body: body.slice(0, 2000) },
  })
  await prisma.supportConversation.update({
    where: { id: conversation.id },
    data: { unread: true, status: "aberto" },
  })
  await prisma.user.update({ where: { id: session.sub }, data: { supportUnread: true, supportStatus: "aberto" } })
  return NextResponse.json(await notesFor(session.sub, conversation.id))
}
