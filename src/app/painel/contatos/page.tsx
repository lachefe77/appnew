import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { whatsAppNumber } from "@/lib/format";

export default async function ResellerContactsPage() {
  const user = await requireUser(["RESELLER", "ADMIN", "MASTER"]);
  const customers = await prisma.resellerCustomer.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } });
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Contatos</h1>
      <p className="text-sm text-muted">Quem já comprou com você, com WhatsApp direto. O cadastro novo continua em Clientes.</p>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
        {customers.map((customer) => (
          <li key={customer.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <span>{customer.name}<span className="block text-xs text-muted">{customer.note || customer.email || "sem nota"}</span></span>
            <a className="text-pine" href={`https://wa.me/${whatsAppNumber(customer.phone)}`}>WhatsApp</a>
          </li>
        ))}
      </ul>
      {customers.length === 0 ? <p className="text-sm text-muted">Nenhum contato ainda.</p> : null}
    </div>
  );
}
