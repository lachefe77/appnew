import Link from "next/link";

const links = [
  ["/admin", "Operação"],
  ["/admin/pedidos", "Pedidos"],
  ["/admin/revendedores", "Revendedores"],
  ["/admin/catalogo", "Catálogo"],
  ["/admin/mensagens", "Mensagens"],
  ["/admin/webhooks", "Webhooks"],
  ["/admin/configuracoes", "Ajustes"],
  ["/admin/equipe", "Equipe"],
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <nav className="flex gap-2 overflow-x-auto">
        {links.map(([href, label]) => (
          <Link key={href} href={href} className="whitespace-nowrap rounded-full border border-line bg-card px-3 py-1.5 text-sm">
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
