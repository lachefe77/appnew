import { roundOdd } from "@/server/feeds/odds"
import { httpGet, type FeedGet, type Offer, type PullResult } from "@/server/feeds/types"

const BASE = "https://www.cloudbet.com/sports-api/c/v6"

const SPORTS = [
  { key: "soccer", slug: "futebol", market: "soccer.total_goals", kind: "total" },
  { key: "basketball", slug: "basquete", market: "basketball.moneyline", kind: "winner" },
  { key: "tennis", slug: "tenis", market: "tennis.winner", kind: "winner" },
  { key: "volleyball", slug: "volei", market: "volleyball.winner", kind: "winner" },
] as const

type Competition = { key?: string; eventCount?: number }
type SportDoc = { categories?: Array<{ competitions?: Competition[] }> }
type Selection = { outcome?: string; params?: string; price?: number; status?: string }
type EventDoc = {
  id?: number
  status?: string
  startTime?: string
  home?: { name?: string }
  away?: { name?: string }
  markets?: Record<string, { submarkets?: Record<string, { selections?: Selection[] }> }>
}

export async function pullCloudbet(get: FeedGet = httpGet): Promise<PullResult> {
  const offers: Offer[] = []
  try {
    for (const sport of SPORTS) {
      const sportRes = await get(`${BASE}/sports/${sport.key}`)
      if (sportRes.status !== 200) {
        return { ok: false, offers: [], detail: `A fonte pública da Cloudbet respondeu HTTP ${sportRes.status}.` }
      }
      const doc = JSON.parse(sportRes.body) as SportDoc
      const keys = topCompetitions(doc, 6)
      for (const key of keys) {
        const eventsRes = await get(
          `${BASE}/sports/competitions/${key}/events?markets=${sport.market}&locale=en&limit=1`,
        )
        if (eventsRes.status !== 200) continue
        const payload = JSON.parse(eventsRes.body) as { events?: EventDoc[] }
        offers.push(...offersFromEvents(sport.slug, payload.events ?? [], sport.market, sport.kind, key))
      }
    }
  } catch (error) {
    return { ok: false, offers: [], detail: error instanceof Error ? error.message : "Falha ao ler a Cloudbet." }
  }
  if (!offers.length) return { ok: false, offers: [], detail: "A Cloudbet respondeu sem evento de dois lados." }
  return { ok: true, offers, detail: `${Math.floor(offers.length / 2)} eventos na fonte pública, sem chave.` }
}

export function topCompetitions(doc: SportDoc, limit: number) {
  const comps: Competition[] = []
  for (const category of doc.categories ?? []) {
    for (const competition of category.competitions ?? []) {
      if ((competition.eventCount ?? 0) > 0 && competition.key) comps.push(competition)
    }
  }
  return comps
    .sort((a, b) => (b.eventCount ?? 0) - (a.eventCount ?? 0))
    .slice(0, limit)
    .map((item) => item.key as string)
}

export function offersFromEvents(
  sportSlug: Offer["sportSlug"],
  events: EventDoc[],
  marketKey: string,
  kind: "winner" | "total",
  competition = "",
) {
  const offers: Offer[] = []
  for (const event of events) {
    if (offers.length >= 24) break
    const status = event.status ?? ""
    if (status !== "TRADING" && !status.includes("LIVE")) continue
    const home = event.home?.name
    const away = event.away?.name
    if (!home || !away || event.id == null) continue
    const market = event.markets?.[marketKey]
    const selections = Object.values(market?.submarkets ?? {})[0]?.selections ?? []
    const legs = kind === "total" ? totalLegs(selections) : winnerLegs(selections)
    if (!legs) continue
    const phase = status.includes("LIVE") ? "live" : "prelive"
    for (const leg of legs) {
      offers.push({
        externalId: `cb:${event.id}`,
        name: `${home} x ${away}`,
        sportSlug,
        phase,
        market: kind === "total" ? "Total" : "Resultado",
        side: leg.side,
        odd: leg.odd,
        startsAt: event.startTime ?? null,
        competition,
      })
    }
  }
  return offers
}

function winnerLegs(selections: Selection[]) {
  const home = selections.find((item) => item.outcome === "home" && item.status !== "SELECTION_DISABLED")
  const away = selections.find((item) => item.outcome === "away" && item.status !== "SELECTION_DISABLED")
  return priced(home?.price, away?.price, "casa", "fora")
}

function totalLegs(selections: Selection[]) {
  const groups = new Map<string, Selection[]>()
  for (const selection of selections) {
    if (selection.status === "SELECTION_DISABLED") continue
    const key = selection.params ?? ""
    const list = groups.get(key) ?? []
    list.push(selection)
    groups.set(key, list)
  }
  let best: Array<{ side: Offer["side"]; odd: number }> | null = null
  let gap = Number.POSITIVE_INFINITY
  for (const group of groups.values()) {
    const over = group.find((item) => item.outcome === "over")
    const under = group.find((item) => item.outcome === "under")
    const legs = priced(over?.price, under?.price, "over", "under")
    if (!legs) continue
    const nextGap = Math.abs(legs[0].odd - legs[1].odd)
    if (nextGap < gap) {
      gap = nextGap
      best = legs
    }
  }
  return best
}

function priced(left: number | undefined, right: number | undefined, leftSide: Offer["side"], rightSide: Offer["side"]) {
  if (left == null || right == null || left <= 1 || right <= 1) return null
  return [
    { side: leftSide, odd: roundOdd(left) },
    { side: rightSide, odd: roundOdd(right) },
  ]
}
