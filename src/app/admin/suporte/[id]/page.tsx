import { notFound } from "next/navigation";
import { ReplyForm } from "@/components/simple-forms";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(["MASTER", "ADMIN", "SUPPORT", "OPERATOR"]);
  const { id } = await params;
  const ticket = await prisma.supportTicket.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  if (!ticket) notFound();
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-3xl font-semibold">{ticket.subject}</h1>
      <p className="text-sm text-muted">{ticket.name} · {ticket.email}</p>
      <ul className="space-y-3">
        {ticket.messages.map((message) => (
          <li key={message.id} className="rounded-2xl border border-line bg-card p-3 text-sm">
            <p className="text-xs text-muted">{message.staff ? "Equipe" : "Cliente"} · {message.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
            <p className="mt-1 whitespace-pre-wrap">{message.body}</p>
          </li>
        ))}
      </ul>
      {ticket.status === "CLOSED" ? <p className="text-sm text-muted">Chamado fechado.</p> : <ReplyForm ticketId={ticket.id} />}
    </div>
  );
}
