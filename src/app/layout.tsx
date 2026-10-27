import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { Header } from "@/components/header";
import { RefCapture } from "@/components/ref-capture";
import { getBrand } from "@/server/brand";
import "./globals.css";

const sans = Outfit({ subsets: ["latin"], variable: "--font-sans" });

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
    title: { default: brand.name, template: `%s · ${brand.name}` },
    description: brand.tagline,
    robots: { index: false, follow: false },
  };
}

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${sans.variable} font-sans text-ink antialiased`}>
        <RefCapture />
        <Header />
        <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6">{children}</main>
        <footer className="border-t border-line bg-card">
          <div className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted sm:px-6">
            <a href="/prazo">Prazo, troca e envio</a>
            <a href="/meus-pedidos">Meus pedidos</a>
            <a href="/contato">Contato</a>
            <a href="/suporte">Suporte</a>
            <a href="/trabalhe-conosco">Trabalhe conosco</a>
            <a href="/revenda">Revenda</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
