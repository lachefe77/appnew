export function Flash({
  erro,
  ok,
  tone = "dark",
}: {
  erro?: string
  ok?: string
  tone?: "dark" | "light"
}) {
  if (erro) {
    return (
      <p
        role="alert"
        className={
          tone === "light"
            ? "mb-4 rounded-md border border-[#e7b4b4] bg-[#fff4f4] px-3 py-2 text-sm text-[#7a2424]"
            : "mb-4 rounded-md border border-[#6e3030] bg-[#2a1414] px-3 py-2 text-sm text-[#ffb4b4]"
        }
      >
        {erro}
      </p>
    )
  }
  if (ok) {
    return (
      <p
        role="status"
        className={
          tone === "light"
            ? "mb-4 rounded-md border border-[#b7e0c8] bg-[#f3fbf6] px-3 py-2 text-sm text-[#085c34]"
            : "mb-4 rounded-md border border-line bg-felt px-3 py-2 text-sm text-signal"
        }
      >
        Alteração registrada.
      </p>
    )
  }
  return null
}
