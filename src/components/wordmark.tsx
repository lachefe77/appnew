export function Wordmark({ name, tone = "dark" }: { name: string; tone?: "dark" | "light" }) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0] ?? "Fut"
  const tail = parts.slice(1).join(" ")
  const chalk = tone === "light" ? "#ffffff" : "#f4f8f5"
  return (
    <span className="mark" style={{ color: chalk }}>
      <svg viewBox="0 0 34 22" aria-hidden>
        <rect x="1" y="1" width="32" height="20" rx="2" fill="none" stroke={chalk} strokeWidth="1.2" />
        <line x1="17" y1="1" x2="17" y2="21" stroke={chalk} strokeOpacity="0.45" />
        <circle cx="17" cy="11" r="4" fill="none" stroke="#f0c14e" strokeWidth="1.2" />
      </svg>
      <span>
        {first}
        {tail ? <span style={{ color: "#f0c14e" }}> {tail}</span> : null}
      </span>
    </span>
  )
}
