export function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function marketFamily(market: string) {
  const value = normalizeName(market)
  if (/\b(handicap|spread|ah)\b/.test(value)) return "handicap"
  if (/\b(total|over|under|gol|gols)\b/.test(value)) return "total"
  if (/\b(1x2|moneyline|vencedor|resultado|winner)\b/.test(value)) return "1x2"
  return value || "outro"
}

export function splitTeams(name: string) {
  const parts = name.split(/\s+(?:vs\.?|x|–|—|-)\s+/i).map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return null
  return [parts[0], parts[1]] as const
}

export function canonicalTeam(name: string, aliases: Map<string, string>) {
  const token = normalizeName(name)
  return aliases.get(`time:${token}`) ?? token
}

export function canonicalCompetition(name: string, aliases: Map<string, string>) {
  const token = normalizeName(name)
  if (!token) return ""
  return aliases.get(`campeonato:${token}`) ?? token
}

export function startBucket(startsAt: Date | null, windowMinutes: number) {
  if (!startsAt || Number.isNaN(startsAt.getTime())) return null
  const windowMs = Math.max(1, windowMinutes) * 60 * 1000
  return String(Math.round(startsAt.getTime() / windowMs))
}

export function matchKey(input: {
  eventId: string
  sport: string
  name: string
  competition?: string
  startsAt: Date | null
  windowMinutes: number
  aliases: Map<string, string>
}) {
  const teams = splitTeams(input.name)
  const bucket = startBucket(input.startsAt, input.windowMinutes)
  if (!teams || !bucket) return `evento:${input.eventId}`
  const names = [canonicalTeam(teams[0], input.aliases), canonicalTeam(teams[1], input.aliases)].sort().join("|")
  return [normalizeName(input.sport), names, bucket].join("::")
}
