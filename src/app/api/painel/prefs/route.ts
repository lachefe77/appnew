import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getSession } from "@/lib/session"

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Entre de novo." }, { status: 401 })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Filtro inválido." }, { status: 400 })
  await prisma.user.update({
    where: { id: session.sub },
    data: { boardPrefs: JSON.stringify(body).slice(0, 8000) },
  })
  return NextResponse.json({ ok: true })
}
