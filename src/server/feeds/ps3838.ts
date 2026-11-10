import { americanToDecimal, roundOdd } from "@/server/feeds/odds"
import { httpGet, type FeedGet, type Offer, type PullResult } from "@/server/feeds/types"

const SPORTS = [
  { id: 29, slug: "futebol" },
  { id: 4, slug: "basquete" },
  { id: 33, slug: "tenis" },
  { id: 34, slug: "volei" },
] as const

type FixtureEvent = { id?: number; home?: string; away?: string; starts?: string; liveStatus?: number; status?: string }
type FixtureLeague = { events?: FixtureEvent[] }
type OddsEvent = { id?: number; periods?: Array<{ number?: number; moneyline?: { home?: number; away?: number; draw?: number }; totals?: Array<{ over?: number; under?: number; altLineId?: number }> }> }
type OddsLeague = { events?: OddsEvent[] }

export function ps3838Ready(user: string, password: string) {
  const name = user.trim()
  const secret = password.trim()
  if (!name || !secret || name === "vazio" || secret === "vazio") return false
  return true
}

export async function pullPs3838(user: string, password: string, get: FeedGet = httpGet): Promise<PullResult> {
  if (!ps3838Ready(user, password)) {
    return {
      ok: false,
      offers: [],
      needsCredential: true,
      detail: "Cole o usuário e a senha da API Ps3838. A conta precisa ter saldo.",
    }
  }
  const token = Buffer.from(`${user.trim()}:${password.trim()}`).toString("base64")
  const headers = { authorization: `Basic ${token}` }
  const offers: Offer[] = []
  try {
    for (const sport of SPORTS) {
      const [fixturesRes, oddsRes] = await Promise.all([
        get(`https://api.ps3838.com/v3/fixtures?sportId=${sport.id}`, { headers }),
        get(`https://api.ps3838.com/v3/odds?sportId=${sport.id}&oddsFormat=Decimal`, { headers }),
      ])
      if (fixturesRes.status === 401 || fixturesRes.status === 403 || oddsRes.status === 401 || oddsRes.status === 403) {
        return { ok: false, offers: [], needsCredential: true, detail: "A Ps3838 recusou o usuário ou a senha." }
      }
      if (fixturesRes.status !== 200 || oddsRes.status !== 200) {
        return { ok: false, offers: [], detail: `A Ps3838 respondeu ${fixturesRes.status}/${oddsRes.status}.` }
      }
      const fixtures = JSON.parse(fixturesRes.body) as { league?: FixtureLeague[] }
      const odds = JSON.parse(oddsRes.body) as { leagues?: OddsLeague[] }
      offers.push(...offersFromPs(sport.slug, fixtures.league ?? [], odds.leagues ?? []))
    }
  } catch (error) {
    return { ok: false, offers: [], detail: error instanceof Error ? error.message : "Falha ao ler a Ps3838." }
  }
  if (!offers.length) return { ok: false, offers: [], detail: "A Ps3838 autenticou, mas não veio evento." }
  return { ok: true, offers, detail: `${offers.length / 2} eventos na API Ps3838.` }
}

export function offersFromPs(sportSlug: Offer["sportSlug"], leagues: FixtureLeague[], oddsLeagues: OddsLeague[]) {
  const names = new Map<number, FixtureEvent>()
  for (const league of leagues) {
    for (const event of league.events ?? []) {
      if (event.id && event.home && event.away) names.set(event.id, event)
    }
  }
  const offers: Offer[] = []
  for (const league of oddsLeagues) {
    for (const event of league.events ?? []) {
      if (!event.id || offers.filter((item) => item.sportSlug === sportSlug).length >= 30) continue
      const info = names.get(event.id)
      if (!info?.home || !info.away) continue
      const period = (event.periods ?? []).find((item) => item.number === 0) ?? event.periods?.[0]
      if (!period) continue
      const moneyline = period.moneyline
      const total = period.totals?.find((item) => item.altLineId == null) ?? period.totals?.[0]
      const money = moneyline && moneyline.draw == null ? pair(moneyline.home, moneyline.away, "casa", "fora") : null
      const totals = money ? null : pair(total?.over, total?.under, "over", "under")
      const legs = money ?? totals
      if (!legs) continue
      const phase = info.liveStatus === 1 ? "live" : "prelive"
      for (const leg of legs) {
        offers.push({
          externalId: `ps:${event.id}`,
          name: `${info.home} x ${info.away}`,
          sportSlug,
          phase,
          market: money ? "Resultado" : "Total",
          side: leg.side,
          odd: leg.odd,
          startsAt: info.starts ?? null,
        })
      }
    }
  }
  return offers
}

function pair(left: number | undefined, right: number | undefined, leftSide: Offer["side"], rightSide: Offer["side"]) {
  const a = left == null ? null : americanToDecimal(Number(left))
  const b = right == null ? null : americanToDecimal(Number(right))
  if (!a || !b || a <= 1 || b <= 1) return null
  return [
    { side: leftSide, odd: roundOdd(a) },
    { side: rightSide, odd: roundOdd(b) },
  ]
}
