import { closeTicketAction } from "@/app/actions/admin"
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
  const tickets = await prisma.supportTicket.findMany({
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  })
  return (
    <>
      <AdminHeading title="Suporte" lede="Sugestões e bugs enviados pelo painel." />
      <Flash erro={query.erro} ok={query.ok} tone="light" />
      {tickets.length ? (
        <div className="sheet">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>Tipo</th>
                <th>Mensagem</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id}>
                  <td className="whitespace-nowrap">{formatDate(ticket.createdAt)}</td>
                  <td>{ticket.user.email}</td>
                  <td>{ticket.kind === "bug" ? "Bug" : "Sugestão"}</td>
                  <td className="max-w-md whitespace-pre-wrap">{ticket.body}</td>
                  <td>{ticket.status === "fechado" ? "Fechado" : "Aberto"}</td>
                  <td>
                    {ticket.status === "aberto" ? (
                      <form action={closeTicketAction}>
                        <input type="hidden" name="ticketId" value={ticket.id} />
                        <button className="btn-admin-ghost" type="submit">
                          Fechar
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyNote>Nenhuma sugestão ou bug ainda. O botão fica no painel de sinais.</EmptyNote>
      )}
    </>
  )
}
