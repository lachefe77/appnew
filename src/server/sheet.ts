export type SheetRow = {
  createdAt: Date
  settledAt: Date | null
  result: string
  amountCents: number
  profitCents: number
}

export function realizedProfit(rows: SheetRow[], since: Date, until = new Date()) {
  return rows.reduce((sum, row) => {
    if (!row.settledAt || row.settledAt < since || row.settledAt > until) return sum
    if (row.result === "ganhou") return sum + row.profitCents
    if (row.result === "perdeu") return sum - row.amountCents
    return sum
  }, 0)
}

export function expectedProfit(rows: SheetRow[], since: Date, until = new Date()) {
  return rows.reduce((sum, row) => {
    if (row.createdAt < since || row.createdAt > until) return sum
    if (row.result !== "pendente") return sum
    return sum + row.profitCents
  }, 0)
}

export function startOfDay(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export function startOfWeek(now: Date) {
  const day = startOfDay(now)
  const weekday = day.getDay() === 0 ? 6 : day.getDay() - 1
  day.setDate(day.getDate() - weekday)
  return day
}

export function startOfMonth(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), 1)
}
