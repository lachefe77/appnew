import { CustomerForm } from "@/components/customer-form";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";

export default async function CustomersPage() {
  const user = await requireUser(["RESELLER", "ADMIN"]);
  const customers = await prisma.resellerCustomer.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } });
  const lastOrders = await prisma.order.findMany({
    where: { tenantId: user.id, customerCpf: { in: customers.map((customer) => customer.cpf) } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-semibold">Clientes</h1>
      <CustomerForm />
      <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
        {customers.map((customer) => {
          const last = lastOrders.find((order) => order.customerCpf === customer.cpf);
          return (
            <li key={customer.id} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-sm">
              <span>{customer.name} · {customer.phone}</span>
              <span className="text-muted">{last ? `Último pedido ${last.publicCode}` : "Sem pedido"}</span>
            </li>
          );
        })}
      </ul>
      {customers.length === 0 ? <p className="text-sm text-muted">Nenhum cliente ainda.</p> : null}
    </div>
  );
}
