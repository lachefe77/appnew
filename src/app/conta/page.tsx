import Link from "next/link";
import { requireUser } from "@/server/auth";
import { roleLabel } from "@/server/roles";

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="space-y-4">
      <h1 className="text-4xl font-semibold">{user.name}</h1>
      <p className="text-sm text-muted">{user.email} · {roleLabel(user.role)}</p>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link className="text-pine" href="/meus-pedidos">Meus pedidos</Link>
        <Link className="text-pine" href="/suporte">Suporte</Link>
        <Link className="text-pine" href="/carrinho">Carrinho</Link>
      </div>
    </div>
  );
}
