export function Wordmark({ name, tone = "dark" }: { name: string; tone?: "dark" | "light" }) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0] ?? "Fut"
  const tail = parts.slice(1).join(" ")
  const base = tone === "light" ? "text-white" : "text-ink"
  return (
    <span className={`font-display text-[1.7rem] font-bold uppercase leading-none tracking-wide ${base}`}>
      {first}
      {tail ? <span className="text-signal"> {tail}</span> : null}
    </span>
  )
}
