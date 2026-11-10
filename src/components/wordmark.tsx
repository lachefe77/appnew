export function Wordmark({ name, tone = "dark" }: { name: string; tone?: "dark" | "light" }) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0] ?? "Fut"
  const tail = parts.slice(1).join(" ")
  const base = tone === "light" ? "text-white" : "text-ink"
  return (
    <span className={`inline-flex items-baseline gap-2 text-[15px] font-semibold tracking-tight ${base}`}>
      <span className="inline-block h-2 w-2 translate-y-[-1px] bg-signal" aria-hidden />
      <span>
        {first}
        {tail ? <span className="text-signal"> {tail}</span> : null}
      </span>
    </span>
  )
}
