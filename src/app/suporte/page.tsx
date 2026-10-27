import { SupportForm } from "@/components/simple-forms";
import { currentUser } from "@/server/auth";
import { getBrand } from "@/server/brand";
import { prisma } from "@/server/db";

export default async function SupportPage() {
  const [user, brand] = await Promise.all([currentUser(), getBrand()]);
  const tickets = user
    ? await prisma.supportTicket.findMany({ where: { userId: user.id }, include: { messages: { orderBy: { createdAt: "asc" } } }, orderBy: { updatedAt: "desc" } })
    : [];
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-4">
        <h1 className="text-4xl font-semibold">Suporte</h1>
        <p className="text-sm text-muted">Escreva para {brand.supportEmail} por aqui. Mestre, administrador e suporte respondem no admin.</p>
        <SupportForm name={user?.name} email={user?.email} />
      </div>
      <div className="space-y-3">
        {tickets.map((ticket) => (
          <article key={ticket.id} className="rounded-2xl border border-line bg-card p-4 text-sm">
            <p className="font-medium">{ticket.subject}</p>
            <p className="text-muted">{ticket.status === "OPEN" ? "Aberto" : ticket.status === "ANSWERED" ? "Respondido" : "Fechado"}</p>
            <ul className="mt-2 space-y-2">
              {ticket.messages.map((message) => (
                <li key={message.id} className="whitespace-pre-wrap">{message.staff ? "Equipe: " : "Você: "}{message.body}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}
