import { httpGet, type FeedGet, type Offer, type PullResult } from "@/server/feeds/types"

const SPORT = {
  football: "futebol",
  basketball: "basquete",
  tennis: "tenis",
  volleyball: "volei",
} as const

type Outcome = { key?: string; odds?: number }
type Market = { kind?: string; outcomes?: Outcome[] }
export type GiroEvent = {
  id?: string
  sport?: string
  league?: { name?: string }
  home?: { name?: string }
  away?: { name?: string }
  startsAt?: string | null
  markets?: Market[]
}

export function offersFromGiro(events: GiroEvent[], phase: "prelive" | "live"): Offer[] {
  const offers: Offer[] = []
  const perSport = new Map<string, number>()
  for (const event of events) {
    const sportSlug = event.sport ? SPORT[event.sport as keyof typeof SPORT] : undefined
    if (!sportSlug || !event.id) continue
    const seen = perSport.get(sportSlug) ?? 0
    if (seen >= 16) continue
    const home = event.home?.name?.trim()
    const away = event.away?.name?.trim()
    if (!home || !away) continue
    const legs = legsOf(event.markets ?? [])
    if (!legs.length) continue
    perSport.set(sportSlug, seen + 1)
    for (const leg of legs) {
      offers.push({
        externalId: `gc:${event.id}`,
        name: `${home} x ${away}`,
        sportSlug,
        phase,
        market: leg.market,
        side: leg.side,
        odd: leg.odd,
        startsAt: event.startsAt ?? null,
        competition: event.league?.name ?? "",
      })
    }
  }
  return offers
}

function legsOf(markets: Market[]) {
  const legs: Array<{ market: string; side: "casa" | "fora" | "over" | "under"; odd: number }> = []
  for (const market of markets) {
    const odds = new Map((market.outcomes ?? []).map((item) => [item.key ?? "", Number(item.odds)]))
    const home = odds.get("home") ?? 0
    const away = odds.get("away") ?? 0
    const over = odds.get("over") ?? 0
    const under = odds.get("under") ?? 0
    if (market.kind === "winner" && !odds.has("draw") && home > 1 && away > 1) {
      legs.push({ market: "Resultado", side: "casa", odd: home }, { market: "Resultado", side: "fora", odd: away })
    }
    if (market.kind === "total" && over > 1 && under > 1) {
      legs.push({ market: "Total", side: "over", odd: over }, { market: "Total", side: "under", odd: under })
    }
  }
  return legs
}

export async function pullGirocerto(get: FeedGet = httpGet): Promise<PullResult> {
  const lists = [
    ["proximos", "prelive"],
    ["ao-vivo", "live"],
  ] as const
  const offers: Offer[] = []
  const notes: string[] = []
  for (const [lista, phase] of lists) {
    try {
      const response = await get(`https://girocerto.io/api/esportes/eventos?lista=${lista}`)
      if (response.status !== 200) {
        notes.push(`${lista} HTTP ${response.status}`)
        continue
      }
      const doc = JSON.parse(response.body) as { events?: GiroEvent[] }
      const parsed = offersFromGiro(doc.events ?? [], phase)
      offers.push(...parsed)
      notes.push(`${lista} HTTP 200, ${parsed.length} pernas`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "falha de rede"
      notes.push(`${lista} falhou (${message})`)
    }
  }
  if (!offers.length) {
    return { ok: false, offers: [], detail: `Giro Certo sem odd pública. ${notes.join(". ")}.` }
  }
  return { ok: true, offers, detail: `Fonte pública da Giro Certo. ${notes.join(". ")}.` }
}
