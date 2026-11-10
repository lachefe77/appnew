export function SiteFooter({ text }: { text: string }) {
  return (
    <footer className="mt-16 border-t border-line">
      <p className="mx-auto max-w-6xl px-4 py-6 text-sm text-mist">{text}</p>
    </footer>
  )
}
