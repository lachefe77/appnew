import { redirect } from "next/navigation"
import { SupportThread } from "@/components/support-thread"
import { prisma } from "@/lib/db"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function SupportPanelPage({ searchParams }: { searchParams: Promise<{ conversa?: string; erro?: string }> }) {
  const session = await getSession()
  if (!session) redirect("/entrar?next=/painel/suporte")
  const query = await searchParams
  await attachLooseMessages(session.sub)
  const conversations = await prisma.supportConversation.findMany({
    where: { userId: session.sub },
    orderBy: { updatedAt: "desc" },
  })
  const active = conversations.find((item) => item.id === query.conversa) ?? conversations[0]
  const notes = active
    ? await prisma.supportMessage.findMany({
        where: { conversationId: active.id },
        orderBy: { createdAt: "asc" },
        include: { author: true },
        take: 200,
      })
    : []

  return (
    <section className="grid min-h-[70vh] md:grid-cols-[240px_1fr]">
      <aside className="border-b border-line bg-felt md:border-b-0 md:border-r">
        <div className="border-b border-line px-4 py-3">
          <h1 className="text-lg font-semibold tracking-tight">Suporte</h1>
          <p className="text-xs text-mist">Suas conversas</p>
        </div>
        <nav className="flex gap-2 overflow-x-auto p-2 md:flex-col" aria-label="Conversas">
          {conversations.map((item) => (
            <a
              key={item.id}
              href={`/painel/suporte?conversa=${item.id}`}
              className={`border px-3 py-2 text-sm ${item.id === active?.id ? "border-signal bg-pitch" : "border-transparent text-mist"}`}
            >
              <span className="block font-semibold text-ink">{item.subject}</span>
              <span className="text-xs">{item.status === "resolvido" ? "Resolvida" : "Aberta"}</span>
            </a>
          ))}
          {!conversations.length ? <p className="px-2 py-3 text-sm text-mist">Nenhuma conversa ainda.</p> : null}
        </nav>
      </aside>
      <div className="px-4 py-4">
        {query.erro ? <p className="mb-3 text-sm text-[#e7a0a0]">{query.erro}</p> : null}
        {active ? (
          <>
            <p className="text-sm text-mist">
              {active.subject} · {active.status === "resolvido" ? "resolvida" : "aberta"}
            </p>
            <div className="mt-4">
              <SupportThread
                conversationId={active.id}
                status={active.status}
                initial={notes.map((row) => ({
                  id: row.id,
                  body: row.body,
                  createdAt: row.createdAt.toISOString(),
                  author: row.author.name,
                  mine: row.authorId === session.sub,
                }))}
              />
            </div>
          </>
        ) : (
          <p className="text-sm text-mist">Abra a primeira conversa com a moderação.</p>
        )}
        <form action={openConversation} className="mt-8 grid max-w-xl gap-2 border-t border-line pt-4">
          <h2 className="text-sm font-semibold">Nova conversa</h2>
          <input className="field" name="subject" placeholder="Assunto" required />
          <textarea className="field min-h-20" name="body" placeholder="Mensagem" required />
          <button className="btn-primary w-fit" type="submit">
            Abrir
          </button>
        </form>
      </div>
    </section>
  )
}

async function attachLooseMessages(userId: string) {
  const loose = await prisma.supportMessage.count({ where: { userId, conversationId: null } })
  if (!loose) return
  const conversation = await prisma.supportConversation.create({
    data: { userId, subject: "Conversa inicial", unread: false },
  })
  await prisma.supportMessage.updateMany({
    where: { userId, conversationId: null },
    data: { conversationId: conversation.id },
  })
}

async function openConversation(formData: FormData) {
  "use server"
  const session = await getSession()
  if (!session) redirect("/entrar")
  const subject = String(formData.get("subject") ?? "").trim()
  const body = String(formData.get("body") ?? "").trim()
  if (subject.length < 2 || body.length < 2) redirect("/painel/suporte?erro=Escreva%20assunto%20e%20mensagem.")
  const conversation = await prisma.supportConversation.create({
    data: { userId: session.sub, subject: subject.slice(0, 80), unread: true },
  })
  await prisma.supportMessage.create({
    data: { userId: session.sub, authorId: session.sub, conversationId: conversation.id, body: body.slice(0, 2000) },
  })
  await prisma.user.update({ where: { id: session.sub }, data: { supportUnread: true, supportStatus: "aberto" } })
  redirect(`/painel/suporte?conversa=${conversation.id}`)
}
