import { redirect } from "next/navigation"
import { SupportThread } from "@/components/support-thread"
import { prisma } from "@/lib/db"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function SupportPanelPage() {
  const session = await getSession()
  if (!session) redirect("/entrar?next=/painel/suporte")
  const rows = await prisma.supportMessage.findMany({
    where: { userId: session.sub },
    orderBy: { createdAt: "asc" },
    include: { author: true },
    take: 200,
  })
  return (
    <section className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="font-display text-5xl uppercase">Suporte integrado</h1>
      <p className="mt-2 text-sm text-mist">A conversa fica com a moderação. A resposta aparece aqui sem recarregar a página.</p>
      <div className="mt-6">
        <SupportThread
          initial={rows.map((row) => ({
            id: row.id,
            body: row.body,
            createdAt: row.createdAt.toISOString(),
            author: row.author.name,
            mine: row.authorId === session.sub,
          }))}
        />
      </div>
    </section>
  )
}
