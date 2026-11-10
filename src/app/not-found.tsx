import Link from "next/link"

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-start justify-center px-4">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal">404</p>
      <h1 className="mt-3 font-display text-5xl uppercase text-ink">Página não encontrada</h1>
      <p className="mt-3 text-mist">Esse caminho não existe no Fut Surebet.</p>
      <Link href="/" className="btn-primary mt-6">
        Voltar ao início
      </Link>
    </main>
  )
}
