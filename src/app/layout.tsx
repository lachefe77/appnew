import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { Header } from "@/components/header";
import "./globals.css";

const sans = Outfit({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: { default: "Novos Horizontes", template: "%s · Novos Horizontes" },
  description: "Vitrine de atacado unitário com carteira pré-paga, PIX e despacho automático.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${sans.variable} font-sans text-ink antialiased`}>
        <Header />
        <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6">{children}</main>
        <footer className="border-t border-line bg-card">
          <div className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted sm:px-6">
            <a href="/prazo">Prazo, troca e envio</a>
            <a href="/meus-pedidos">Meus pedidos</a>
            <a href="/carrinho">Carrinho</a>
            <a href="/revenda">Revenda</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
