import { httpGet, type FeedGet, type Offer, type PullResult } from "@/server/feeds/types"

const PUBLIC_URL = "https://api-k-c7818b61-623.sptpub.com/api/v3/prematch/brand/2103509236163162112/en/0"

const SPORT_NAME: Record<string, Offer["sportSlug"]> = {
  soccer: "futebol",
  football: "futebol",
  basketball: "basquete",
  tennis: "tenis",
  volleyball: "volei",
}

type RawEvent = {
  id?: string | number
  desc?: {
    scheduled?: number
    sport?: { name?: string } | string
    competitors?: Array<{ name?: string }>
  }
  state?: { status?: number }
  markets?: Record<string, Record<string, { k?: string }>>
}

export async function pullBcgame(get: FeedGet = httpGet): Promise<PullResult> {
  try {
    const response = await get(PUBLIC_URL, { headers: { origin: "https://bc.game", referer: "https://bc.game/" } })
    if (response.status !== 200) {
      return {
        ok: false,
        offers: [],
        detail: `A fonte pública da Bcgame respondeu ${response.status}. Não há chave de conta para colar.`,
      }
    }
    const payload = JSON.parse(response.body) as { error?: string; events?: RawEvent[] | Record<string, RawEvent> }
    if (payload.error) {
      return { ok: false, offers: [], detail: `A fonte pública da Bcgame disse: ${payload.error}.` }
    }
    const events = Array.isArray(payload.events) ? payload.events : Object.values(payload.events ?? {})
    const offers = offersFromBc(events)
    if (!offers.length) {
      return { ok: false, offers: [], detail: "A Bcgame respondeu sem evento de dois lados." }
    }
    return { ok: true, offers, detail: `${offers.length / 2} eventos na fonte pública da Bcgame.` }
  } catch (error) {
    return {
      ok: false,
      offers: [],
      detail: error instanceof Error ? error.message : "Falha ao ler a Bcgame.",
    }
  }
}

export function offersFromBc(events: RawEvent[]) {
  const offers: Offer[] = []
  for (const event of events) {
    if (offers.length >= 40) break
    const names = (event.desc?.competitors ?? []).map((item) => item.name).filter((name): name is string => Boolean(name))
    if (names.length < 2 || event.id == null) continue
    const sportName = typeof event.desc?.sport === "string" ? event.desc.sport : event.desc?.sport?.name ?? ""
    const sportSlug = SPORT_NAME[sportName.toLowerCase()]
    if (!sportSlug) continue
    const odd = firstTwoWay(event.markets)
    if (!odd) continue
    const phase = event.state?.status === 1 ? "live" : "prelive"
    const startsAt = event.desc?.scheduled ? new Date(event.desc.scheduled * 1000).toISOString() : null
    for (const leg of odd.legs) {
      offers.push({
        externalId: `bc:${event.id}`,
        name: `${names[0]} x ${names[1]}`,
        sportSlug,
        phase,
        market: odd.market,
        side: leg.side,
        odd: leg.odd,
        startsAt,
      })
    }
  }
  return offers
}

function firstTwoWay(markets: RawEvent["markets"]) {
  if (!markets) return null
  for (const [key, lines] of Object.entries(markets)) {
    const prices = Object.values(lines)
      .map((line) => Number(line.k))
      .filter((price) => price > 1)
    if (prices.length !== 2) continue
    const market = key === "1" ? "Resultado" : "Mercado"
    return {
      market,
      legs: [
        { side: "casa" as const, odd: Math.round(prices[0] * 1000) / 1000 },
        { side: "fora" as const, odd: Math.round(prices[1] * 1000) / 1000 },
      ],
    }
  }
  return null
}
