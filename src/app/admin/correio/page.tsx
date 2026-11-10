import { AdminHeading, EmptyNote } from "@/components/admin-ui"
import { prisma } from "@/lib/db"
import { formatDate } from "@/lib/format"
import { requireAdmin } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function MailPage() {
  await requireAdmin()
  const messages = await prisma.mailMessage.findMany({ orderBy: { createdAt: "desc" }, take: 30 })
  return (
    <>
      <AdminHeading
        title="Correio"
        lede="Confirmação de e-mail e recuperação de senha. Sem webhook, a mensagem fica aqui para a administração entregar o link."
      />
      {messages.length ? (
        <div className="grid gap-3">
          {messages.map((message) => (
            <article key={message.id} className="panel">
              <p className="text-xs text-black/50">
                {formatDate(message.createdAt)} · {message.to} · {message.status}
              </p>
              <h2 className="font-semibold">{message.subject}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm">{message.body}</p>
            </article>
          ))}
        </div>
      ) : (
        <EmptyNote>Nenhuma mensagem na fila.</EmptyNote>
      )}
    </>
  )
}
