import type { Metadata } from "next"
import "@fontsource/outfit/400.css"
import "@fontsource/outfit/500.css"
import "@fontsource/outfit/600.css"
import "@fontsource/outfit/700.css"
import "@fontsource/barlow-condensed/600.css"
import "@fontsource/barlow-condensed/700.css"
import "./globals.css"
import { getSettings } from "@/server/settings"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings()
  const name = settings.get("brand.name")
  return {
    title: { default: name, template: `%s · ${name}` },
    description: settings.get("brand.tagline"),
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
