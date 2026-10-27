import { AdminNav } from "@/components/admin-nav";
import { currentUser } from "@/server/auth";
import { isStaff } from "@/server/roles";

const links: Array<[string, string]> = [
  ["/admin", "Operação"],
  ["/admin/pedidos", "Pedidos"],
  ["/admin/catalogo", "Catálogo"],
  ["/admin/usuarios", "Usuários"],
  ["/admin/antifraude", "Antifraude"],
  ["/admin/suporte", "Suporte"],
  ["/admin/contatos", "Contatos"],
  ["/admin/curriculos", "Currículos"],
  ["/admin/afiliados", "Afiliados"],
  ["/admin/revendedores", "Revendedores"],
  ["/admin/mensagens", "Mensagens"],
  ["/admin/webhooks", "Webhooks"],
  ["/admin/configuracoes", "Ajustes"],
  ["/admin/equipe", "Equipe"],
];

const supportOnly = new Set([
  "/admin",
  "/admin/pedidos",
  "/admin/usuarios",
  "/admin/antifraude",
  "/admin/suporte",
  "/admin/contatos",
  "/admin/curriculos",
  "/admin/mensagens",
]);

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const visible = user && isStaff(user.role) && user.role !== "MASTER" && user.role !== "ADMIN"
    ? links.filter(([href]) => supportOnly.has(href))
    : links;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[220px_1fr]">
      <AdminNav links={visible} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
