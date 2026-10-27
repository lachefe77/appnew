import { OperatorForm } from "@/components/operator-form";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";

export default async function TeamPage() {
  const user = await requireUser(["ADMIN", "OPERATOR"]);
  const operators = await prisma.user.findMany({ where: { role: "OPERATOR" }, orderBy: { createdAt: "desc" } });
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Equipe</h1>
      <p className="max-w-2xl text-sm text-muted">
        O dono entra com o login admin. O operador vê pedidos, catálogo, mensagens e webhooks. Não pausa a fila, não estorna e não mexe no saldo.
      </p>
      <ul className="text-sm">
        {operators.map((operator) => (
          <li key={operator.id}>{operator.name} · {operator.email}</li>
        ))}
        {operators.length === 0 ? <li className="text-muted">Nenhum operador ainda.</li> : null}
      </ul>
      {user.role === "ADMIN" ? <OperatorForm /> : null}
    </div>
  );
}
