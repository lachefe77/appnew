import { replySupportAction, resolveSupportAction } from "@/app/actions/admin"
import { AdminHeading, EmptyNote } from "@/components/admin-ui"
import { Flash } from "@/components/flash"
import { prisma } from "@/lib/db"
import { formatDate } from "@/lib/format"

export const dynamic = "force-dynamic"

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; ok?: string; conversa?: string }>
}) {
  const query = await searchParams
  const conversations = await prisma.supportConversation.findMany({
    include: { user: true },
    orderBy: { updatedAt: "desc" },
    take: 80,
  })
  const active = conversations.find((item) => item.id === query.conversa) ?? conversations[0]
  const notes = active
    ? await prisma.supportMessage.findMany({
        where: { conversationId: active.id },
        orderBy: { createdAt: "asc" },
        include: { author: true },
      })
    : []

  return (
    <>
      <AdminHeading title="Suporte" lede="Mesa de conversas. Admin e moderador respondem. O cliente vê a resposta sem recarregar." />
      <Flash erro={query.erro} ok={query.ok} tone="light" />
      {conversations.length ? (
        <div className="grid min-h-[32rem] border border-black/10 md:grid-cols-[260px_1fr]">
          <aside className="border-b border-black/10 bg-[#f6f8f7] md:border-b-0 md:border-r">
            {conversations.map((item) => (
              <a
                key={item.id}
                href={`/admin/suporte?conversa=${item.id}`}
                className={`block border-b border-black/5 px-3 py-3 text-sm ${item.id === active?.id ? "bg-white" : ""}`}
              >
                <span className="font-semibold">{item.subject}</span>
                <span className="mt-0.5 block text-xs text-black/50">
                  {item.user.email} · {item.unread ? "nova" : item.status}
                </span>
              </a>
            ))}
          </aside>
          {active ? (
            <div className="bg-white p-4">
              <h2 className="font-semibold">{active.subject}</h2>
              <p className="text-xs text-black/50">
                {active.user.name} · {active.user.email} · {active.status}
              </p>
              <div className="mt-4 space-y-2">
                {notes.map((note) => (
                  <p key={note.id} className="rounded-md bg-[#f6f8f7] px-3 py-2 text-sm">
                    <span className="text-xs text-black/50">
                      {note.author.role === "cliente" ? "Cliente" : "Mesa"} · {formatDate(note.createdAt)}
                    </span>
                    <span className="mt-1 block whitespace-pre-wrap">{note.body}</span>
                  </p>
                ))}
              </div>
              <form action={replySupportAction} className="mt-4 flex gap-2">
                <input type="hidden" name="conversationId" value={active.id} />
                <input className="field-light" name="body" placeholder="Resposta" required />
                <button className="btn-admin" type="submit">
                  Responder
                </button>
              </form>
              <form action={resolveSupportAction} className="mt-2">
                <input type="hidden" name="conversationId" value={active.id} />
                <button className="btn-admin-ghost" type="submit">
                  Marcar como resolvida
                </button>
              </form>
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyNote>Nenhuma conversa ainda. O cliente abre em Suporte.</EmptyNote>
      )}
    </>
  )
}
