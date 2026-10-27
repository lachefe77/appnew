import Link from "next/link";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";

const label = { OPEN: "Aberto", ANSWERED: "Respondido", CLOSED: "Fechado" };

export default async function AdminSupportPage() {
  await requireUser(["MASTER", "ADMIN", "SUPPORT", "OPERATOR"]);
  const tickets = await prisma.supportTicket.findMany({ orderBy: { updatedAt: "desc" }, take: 50, include: { messages: true } });
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Suporte</h1>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
        {tickets.map((ticket) => (
          <li key={ticket.id}>
            <Link href={`/admin/suporte/${ticket.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span>{ticket.subject}<span className="mt-1 block text-xs text-muted">{ticket.name} · {ticket.email}</span></span>
              <span>{label[ticket.status]}</span>
            </Link>
          </li>
        ))}
      </ul>
      {tickets.length === 0 ? <p className="text-sm text-muted">Nenhum chamado.</p> : null}
    </div>
  );
}
