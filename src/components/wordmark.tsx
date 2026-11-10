export function Wordmark({ name, tone = "dark" }: { name: string; tone?: "dark" | "light" }) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0] ?? "Fut"
  const tail = parts.slice(1).join(" ")
  const chalk = tone === "light" ? "#ffffff" : "#161815"
  return (
    <span className="mark" style={{ color: chalk }}>
      {first}
      {tail ? <span style={{ color: "#0c6b3c" }}> {tail}</span> : null}
    </span>
  )
}
