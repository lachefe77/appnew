import Link from "next/link";

const links = [
  ["/painel", "Início"],
  ["/painel/carteira", "Extrato"],
  ["/painel/recargas", "Recargas"],
  ["/painel/catalogo", "Catálogo"],
  ["/painel/vitrine", "Minha vitrine"],
  ["/painel/clientes", "Clientes"],
  ["/painel/contatos", "Contatos"],
  ["/painel/afiliados", "Afiliados"],
  ["/painel/pedidos", "Pedidos"],
];

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-2">
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
