import Link from "next/link";

const links = [
  ["/painel", "Saldo"],
  ["/painel/carteira", "Extrato"],
  ["/painel/catalogo", "Catálogo"],
  ["/painel/pedidos", "Pedidos"],
];

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <nav className="flex gap-2 overflow-x-auto">
        {links.map(([href, label]) => (
          <Link key={href} href={href} className="rounded-full border border-line bg-card px-3 py-1.5 text-sm whitespace-nowrap">
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
