import Link from "next/link";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { roleLabel } from "@/server/roles";
import { formatBRL } from "@/lib/format";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; cargo?: string }> }) {
  await requireUser(["MASTER", "ADMIN", "SUPPORT", "OPERATOR"]);
  const { q, cargo } = await searchParams;
  const roles = ["MASTER", "ADMIN", "SUPPORT", "RESELLER", "CUSTOMER"] as const;
  const role = roles.find((item) => item === cargo);
  const users = await prisma.user.findMany({
    where: {
      ...(role ? { role } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
    },
    include: { wallet: true, _count: { select: { orders: true } } },
    orderBy: { createdAt: "desc" },
    take: 80,
  });
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Usuários</h1>
      <form className="flex flex-wrap gap-2" action="/admin/usuarios">
        <input className="field w-64" name="q" defaultValue={q ?? ""} placeholder="Nome ou e-mail" />
        <select className="field w-auto" name="cargo" defaultValue={cargo ?? ""}>
          <option value="">Todos os cargos</option>
          {roles.map((item) => <option key={item} value={item}>{roleLabel(item)}</option>)}
        </select>
        <button className="rounded-full bg-ink px-4 py-2 text-sm text-white">Filtrar</button>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.14em] text-muted">
            <tr><th className="py-2">Nome</th><th>Cargo</th><th>Situação</th><th>Saldo</th><th>Pedidos</th></tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t border-line">
                <td className="py-2"><Link className="text-pine" href={`/admin/usuarios/${user.id}`}>{user.name}</Link><p className="text-xs text-muted">{user.email}</p></td>
                <td>{roleLabel(user.role)}</td>
                <td>{user.planStatus === "SUSPENDED" ? "Suspenso" : user.planStatus === "ACTIVE" ? "Ativo" : "Inativo"}</td>
                <td>{formatBRL(Number(user.wallet?.balanceCents ?? 0))}</td>
                <td>{user._count.orders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
