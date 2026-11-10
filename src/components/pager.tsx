import Link from "next/link"

export function Pager({ page, pages, href }: { page: number; pages: number; href: string }) {
  if (pages <= 1) return null
  const prev = Math.max(1, page - 1)
  const next = Math.min(pages, page + 1)
  return (
    <p className="mt-4 flex gap-3 text-sm">
      <Link className="link-admin" href={`${href}${href.includes("?") ? "&" : "?"}page=${prev}`}>
        Anterior
      </Link>
      <span>
        {page} / {pages}
      </span>
      <Link className="link-admin" href={`${href}${href.includes("?") ? "&" : "?"}page=${next}`}>
        Próxima
      </Link>
    </p>
  )
}
