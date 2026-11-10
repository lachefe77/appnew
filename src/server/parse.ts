export function centsFromInput(raw: string): number | null {
  const value = raw.trim()
  if (!value) return null
  let normalized = value
  if (value.includes(",") && value.includes(".")) {
    normalized = value.replace(/\./g, "").replace(",", ".")
  } else if (value.includes(",")) {
    normalized = value.replace(",", ".")
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const [whole, frac = ""] = normalized.split(".")
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"))
  if (!Number.isSafeInteger(cents)) return null
  return cents
}

export function daysFromInput(raw: string): number | null | "invalid" {
  const value = raw.trim()
  if (!value) return null
  if (!/^\d+$/.test(value)) return "invalid"
  return Number(value)
}
