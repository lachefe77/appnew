import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getSession } from "@/lib/session"

async function notesFor(userId: string) {
  const rows = await prisma.supportMessage.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { author: true },
    take: 200,
  })
  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    author: row.author.name,
    mine: row.authorId === userId,
  }))
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Entre de novo." }, { status: 401 })
  return NextResponse.json({ notes: await notesFor(session.sub) })
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Entre de novo." }, { status: 401 })
  const body = String(((await request.json().catch(() => ({}))) as { body?: string }).body ?? "").trim()
  if (body.length < 2) return NextResponse.json({ error: "Escreva a mensagem." }, { status: 400 })
  await prisma.supportMessage.create({
    data: { userId: session.sub, authorId: session.sub, body: body.slice(0, 2000) },
  })
  return NextResponse.json({ notes: await notesFor(session.sub) })
}
