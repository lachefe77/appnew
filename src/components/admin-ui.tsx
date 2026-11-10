export function AdminHeading({ title, lede }: { title: string; lede?: string }) {
  return (
    <header className="mb-6">
      <h1 className="font-display text-4xl uppercase tracking-wide text-rail">{title}</h1>
      {lede ? <p className="mt-1 max-w-2xl text-sm text-black/70">{lede}</p> : null}
    </header>
  )
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-black/15 bg-white px-4 py-10 text-center text-sm text-black/60">
      {children}
    </p>
  )
}
