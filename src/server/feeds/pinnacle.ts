import { americanToDecimal, roundOdd } from "@/server/feeds/odds"
import { httpGet, type FeedGet, type Offer, type PullResult } from "@/server/feeds/types"

const BASE = "https://guest.api.arcadia.pinnacle.com/0.1"

const SPORTS = [
  { id: 29, slug: "futebol" },
  { id: 4, slug: "basquete" },
  { id: 33, slug: "tenis" },
  { id: 34, slug: "volei" },
] as const

type Matchup = {
  id: number
  parentId?: number | null
  isLive?: boolean
  startTime?: string
  participants?: Array<{ id?: number; alignment?: string; name?: string }>
}

type Market = {
  matchupId?: number
  period?: number
  type?: string
  isAlternate?: boolean
  status?: string
  prices?: Array<{ designation?: string; participantId?: number; price?: number }>
}

export async function pullPinnacle(get: FeedGet = httpGet): Promise<PullResult> {
  const offers: Offer[] = []
  try {
    for (const sport of SPORTS) {
      const [matchupsRes, marketsRes] = await Promise.all([
        get(`${BASE}/sports/${sport.id}/matchups?withSpecials=false`),
        get(`${BASE}/sports/${sport.id}/markets/straight?primaryOnly=true`),
      ])
      if (matchupsRes.status !== 200 || marketsRes.status !== 200) {
        return {
          ok: false,
          offers: [],
          detail: `Fonte pública da Pinnacle respondeu ${matchupsRes.status}/${marketsRes.status}.`,
        }
      }
      const matchups = JSON.parse(matchupsRes.body) as Matchup[]
      const markets = JSON.parse(marketsRes.body) as Market[]
      offers.push(...offersFromSport(sport.slug, matchups, markets))
    }
  } catch (error) {
    return {
      ok: false,
      offers: [],
      detail: error instanceof Error ? error.message : "Falha ao ler a Pinnacle.",
    }
  }
  if (!offers.length) {
    return { ok: false, offers: [], detail: "A Pinnacle respondeu, mas não veio evento de dois lados." }
  }
  return { ok: true, offers, detail: `${offers.length / 2} eventos na fonte pública.` }
}

export function offersFromSport(sportSlug: Offer["sportSlug"], matchups: Matchup[], markets: Market[]) {
  const games = new Map<number, Matchup>()
  for (const matchup of matchups) {
    if (matchup.parentId) continue
    const people = matchup.participants ?? []
    if (people.length !== 2) continue
    games.set(matchup.id, matchup)
  }
  const byMatch = new Map<number, Market[]>()
  for (const market of markets) {
    if (market.period !== 0 || market.status === "closed" || market.isAlternate) continue
    if (!market.matchupId || !games.has(market.matchupId)) continue
    const list = byMatch.get(market.matchupId) ?? []
    list.push(market)
    byMatch.set(market.matchupId, list)
  }
  const ranked = [...games.values()].sort((a, b) => {
    const live = Number(b.isLive) - Number(a.isLive)
    if (live !== 0) return live
    return (a.startTime ?? "").localeCompare(b.startTime ?? "")
  })
  const offers: Offer[] = []
  for (const game of ranked) {
    if (offers.filter((item) => item.sportSlug === sportSlug).length >= 30) break
    const home = game.participants?.find((item) => item.alignment === "home")
    const away = game.participants?.find((item) => item.alignment === "away")
    if (!home?.name || !away?.name) continue
    const picked = pickMarket(byMatch.get(game.id) ?? [], home.id, away.id)
    if (!picked) continue
    for (const leg of picked.legs) {
      offers.push({
        externalId: `pin:${game.id}`,
        name: `${home.name} x ${away.name}`,
        sportSlug,
        phase: game.isLive ? "live" : "prelive",
        market: picked.market,
        side: leg.side,
        odd: leg.odd,
        startsAt: game.startTime ?? null,
      })
    }
  }
  return offers
}

function pickMarket(markets: Market[], homeId?: number, awayId?: number) {
  for (const market of markets) {
    if (market.type !== "moneyline") continue
    const legs = twoSides(market, homeId, awayId, "casa", "fora")
    if (legs) return { market: "Resultado", legs }
  }
  for (const market of markets) {
    if (market.type !== "total") continue
    const legs = twoSides(market, homeId, awayId, "over", "under")
    if (legs) return { market: "Total", legs }
  }
  return null
}

function twoSides(market: Market, homeId: number | undefined, awayId: number | undefined, homeSide: "casa" | "over", awaySide: "fora" | "under") {
  const prices = market.prices ?? []
  if (prices.length !== 2) return null
  const legs: Array<{ side: Offer["side"]; odd: number }> = []
  for (const price of prices) {
    const odd = americanToDecimal(Number(price.price))
    if (!odd || odd <= 1) return null
    const designation = (price.designation ?? "").toLowerCase()
    let side: Offer["side"] | null = null
    if (designation === "home" || designation === "over") side = homeSide
    else if (designation === "away" || designation === "under") side = awaySide
    else if (price.participantId && price.participantId === homeId) side = "casa"
    else if (price.participantId && price.participantId === awayId) side = "fora"
    if (!side) return null
    legs.push({ side, odd: roundOdd(odd) })
  }
  if (new Set(legs.map((leg) => leg.side)).size !== 2) return null
  return legs
}
