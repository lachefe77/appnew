import Link from "next/link";
import { currentUser } from "@/server/auth";
import { isStaff } from "@/server/roles";

const links = [
  ["/admin", "Operação"],
  ["/admin/pedidos", "Pedidos"],
  ["/admin/usuarios", "Usuários"],
  ["/admin/suporte", "Suporte"],
  ["/admin/contatos", "Contatos"],
  ["/admin/curriculos", "Currículos"],
  ["/admin/afiliados", "Afiliados"],
  ["/admin/revendedores", "Revendedores"],
  ["/admin/catalogo", "Catálogo"],
  ["/admin/mensagens", "Mensagens"],
  ["/admin/webhooks", "Webhooks"],
  ["/admin/configuracoes", "Ajustes"],
  ["/admin/equipe", "Equipe"],
];

const supportOnly = new Set(["/admin", "/admin/pedidos", "/admin/usuarios", "/admin/suporte", "/admin/contatos", "/admin/curriculos", "/admin/mensagens"]);

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const visible = user && isStaff(user.role) && user.role !== "MASTER" && user.role !== "ADMIN"
    ? links.filter(([href]) => supportOnly.has(href))
    : links;
  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-2">
        {visible.map(([href, label]) => (
          <Link key={href} href={href} className="whitespace-nowrap rounded-full border border-line bg-card px-3 py-1.5 text-sm">
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
