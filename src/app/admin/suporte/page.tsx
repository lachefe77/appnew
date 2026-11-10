import { replySupportAction } from "@/app/actions/admin"
import { AdminHeading, EmptyNote } from "@/components/admin-ui"
import { Flash } from "@/components/flash"
import { prisma } from "@/lib/db"
import { formatDate } from "@/lib/format"

export const dynamic = "force-dynamic"

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; ok?: string }>
}) {
  const query = await searchParams
  const threads = await prisma.user.findMany({
    where: { supportThreads: { some: {} } },
    include: {
      supportThreads: { orderBy: { createdAt: "asc" }, include: { author: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  })
  return (
    <>
      <AdminHeading title="Suporte" lede="Conversas do painel. A resposta aparece para o cliente sem recarregar a página dele." />
      <Flash erro={query.erro} ok={query.ok} tone="light" />
      {threads.length ? (
        <div className="grid gap-4">
          {threads.map((user) => (
            <article key={user.id} className="panel">
              <h2 className="font-semibold">{user.name}</h2>
              <p className="text-xs text-black/50">{user.email}</p>
              <div className="mt-3 space-y-2">
                {user.supportThreads.map((note) => (
                  <p key={note.id} className="rounded-md bg-[#f6f8f7] px-3 py-2 text-sm">
                    <span className="text-xs text-black/50">
                      {note.author.role === "admin" ? "Moderação" : "Cliente"} · {formatDate(note.createdAt)}
                    </span>
                    <span className="mt-1 block whitespace-pre-wrap">{note.body}</span>
                  </p>
                ))}
              </div>
              <form action={replySupportAction} className="mt-3 flex gap-2">
                <input type="hidden" name="userId" value={user.id} />
                <input className="field-light" name="body" placeholder="Resposta" required />
                <button className="btn-admin" type="submit">
                  Responder
                </button>
              </form>
            </article>
          ))}
        </div>
      ) : (
        <EmptyNote>Nenhuma conversa ainda. O cliente escreve em Suporte integrado.</EmptyNote>
      )}
    </>
  )
}
