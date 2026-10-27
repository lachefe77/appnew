import { StaffCreateForm } from "@/components/simple-forms";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { roleLabel } from "@/server/roles";

export default async function TeamPage() {
  const user = await requireUser(["MASTER", "ADMIN"]);
  const people = await prisma.user.findMany({
    where: { role: { in: ["MASTER", "ADMIN", "SUPPORT"] } },
    orderBy: { createdAt: "asc" },
  });
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Equipe</h1>
      <p className="max-w-2xl text-sm text-muted">
        Mestre é o dono. Administrador opera a casa e não muda o mestre. Suporte responde chamado, contato e currículo, e não mexe em saldo, preço nem ajuste.
      </p>
      <ul className="text-sm">
        {people.map((person) => (
          <li key={person.id}>{roleLabel(person.role)} · {person.name} · {person.email}</li>
        ))}
      </ul>
      {user.role === "MASTER" || user.role === "ADMIN" ? <StaffCreateForm /> : null}
    </div>
  );
}
