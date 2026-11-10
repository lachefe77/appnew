export type Rates = {
  USD: number
  EUR: number
}

export type BoardQuote = {
  eventId: string
  eventName: string
  sportName: string
  sportImage: string
  phase: "prelive" | "live"
  market: string
  houseId: string
  houseName: string
  houseSlug: string
  logoUrl: string
  currency: string
  cloneLabel: string
  feed: string
  side: string
  odd: number
}

export type BoardLeg = {
  houseId: string
  houseName: string
  houseSlug: string
  logoUrl: string
  currency: string
  cloneLabel: string
  feed: string
  side: string
  odd: number
  stakeCents: number
  stakeHouseCents: number
}

export type BoardSignal = {
  key: string
  eventId: string
  eventName: string
  sportName: string
  sportImage: string
  phase: "prelive" | "live"
  market: string
  profitPercent: number
  profitCents: number
  totalStakeCents: number
  highlight: boolean
  leg1: BoardLeg
  leg2: BoardLeg
}

export type BoardOptions = {
  includedHouseIds?: string[]
  fixedSides?: Record<string, string>
  manualOdds?: Record<string, number>
  autoMarketHouseIds?: string[]
  pinnedHouseId?: string | null
  market?: string
  minProfit?: number
  highlightAbove?: number
  totalStakeCents: number
  rates: Rates
  sort?: "alfa" | "clone"
}

const SIDES = ["casa", "fora", "over", "under"] as const

export function profitOf(odd1: number, odd2: number) {
  if (!(odd1 > 1) || !(odd2 > 1)) return null
  const implied = 1 / odd1 + 1 / odd2
  if (!(implied < 1)) return null
  const ratio = 1 / implied - 1
  return {
    implied,
    profitPercent: ratio * 100,
  }
}

export function stakesFor(totalCents: number, odd1: number, odd2: number) {
  const profit = profitOf(odd1, odd2)
  if (!profit || !Number.isInteger(totalCents) || totalCents <= 0) return null
  const inv1 = 1 / odd1
  const stake1 = Math.round((totalCents * inv1) / profit.implied)
  const stake2 = totalCents - stake1
  const profitCents = Math.round(totalCents * (profit.profitPercent / 100))
  return {
    stake1,
    stake2,
    profitCents,
    profitPercent: profit.profitPercent,
  }
}

export function toHouseCents(brlCents: number, currency: string, rates: Rates) {
  if (currency === "USD") return Math.round(brlCents / rates.USD)
  if (currency === "EUR") return Math.round(brlCents / rates.EUR)
  return brlCents
}

function roundOdd(value: number) {
  return Math.round(value * 1000) / 1000
}

export function buildSignals(quotes: BoardQuote[], options: BoardOptions): BoardSignal[] {
  const included = options.includedHouseIds ? new Set(options.includedHouseIds) : null
  const fixed = options.fixedSides ?? {}
  const manual = options.manualOdds ?? {}
  const autoMarket = new Set(options.autoMarketHouseIds ?? [])
  const minProfit = options.minProfit ?? 0
  const highlightAbove = options.highlightAbove ?? 7
  const marketFilter = (options.market ?? "").trim().toLowerCase()

  const usable = quotes
    .map((quote) => {
      const replacement = manual[quote.houseId]
      const odd = replacement && replacement > 1 ? replacement : quote.odd
      return { ...quote, odd: roundOdd(odd) }
    })
    .filter((quote) => {
      if (included && !included.has(quote.houseId)) return false
      if (!(quote.odd > 1)) return false
      const side = fixed[quote.houseId]
      if (side && side !== quote.side) return false
      return true
    })

  const groups = new Map<string, BoardQuote[]>()
  for (const quote of usable) {
    const key = `${quote.eventId}::${quote.market}`
    const list = groups.get(key) ?? []
    list.push(quote)
    groups.set(key, list)
  }

  const found: BoardSignal[] = []
  for (const group of groups.values()) {
    const pair = bestPair(group)
    if (!pair) continue
    if (marketFilter && marketFilter !== "todos" && pair.market.toLowerCase() !== marketFilter) {
      const allowed = autoMarket.has(pair.left.houseId) || autoMarket.has(pair.right.houseId)
      if (!allowed) continue
    }
    if (options.pinnedHouseId && pair.left.houseId !== options.pinnedHouseId && pair.right.houseId !== options.pinnedHouseId) {
      continue
    }
    const stakes = stakesFor(options.totalStakeCents, pair.left.odd, pair.right.odd)
    if (!stakes || stakes.profitPercent < minProfit) continue
    const [first, second] =
      pair.left.houseName.localeCompare(pair.right.houseName, "pt-BR") <= 0
        ? [pair.left, pair.right]
        : [pair.right, pair.left]
    const firstStake = first === pair.left ? stakes.stake1 : stakes.stake2
    const secondStake = first === pair.left ? stakes.stake2 : stakes.stake1
    const key = [pair.eventId, pair.market, first.houseId, first.side, second.houseId, second.side].join(":")
    found.push({
      key,
      eventId: pair.eventId,
      eventName: pair.eventName,
      sportName: pair.sportName,
      sportImage: pair.sportImage,
      phase: pair.phase,
      market: pair.market,
      profitPercent: stakes.profitPercent,
      profitCents: stakes.profitCents,
      totalStakeCents: options.totalStakeCents,
      highlight: stakes.profitPercent > highlightAbove,
      leg1: leg(first, firstStake, options.rates),
      leg2: leg(second, secondStake, options.rates),
    })
  }

  const autoIds = autoMarket
  const deduped = new Map<string, BoardSignal>()
  for (const signal of found) {
    const usesAuto = autoIds.has(signal.leg1.houseId) || autoIds.has(signal.leg2.houseId)
    const bucket = usesAuto ? signal.eventId : `${signal.eventId}::${signal.market}`
    const current = deduped.get(bucket)
    if (!current || signal.profitPercent > current.profitPercent) deduped.set(bucket, signal)
  }

  const list = [...deduped.values()]
  list.sort((a, b) => {
    if (options.sort === "alfa") return a.eventName.localeCompare(b.eventName, "pt-BR")
    const clone = a.leg1.cloneLabel.localeCompare(b.leg1.cloneLabel, "pt-BR")
    if (clone !== 0) return clone
    return b.profitPercent - a.profitPercent
  })
  return list
}

function leg(quote: BoardQuote, stakeCents: number, rates: Rates): BoardLeg {
  return {
    houseId: quote.houseId,
    houseName: quote.houseName,
    houseSlug: quote.houseSlug,
    logoUrl: quote.logoUrl,
    currency: quote.currency,
    cloneLabel: quote.cloneLabel,
    feed: quote.feed,
    side: quote.side,
    odd: quote.odd,
    stakeCents,
    stakeHouseCents: toHouseCents(stakeCents, quote.currency, rates),
  }
}

function bestPair(group: BoardQuote[]) {
  const bySide = new Map<string, BoardQuote[]>()
  for (const quote of group) {
    if (!SIDES.includes(quote.side as (typeof SIDES)[number])) continue
    const list = bySide.get(quote.side) ?? []
    list.push(quote)
    bySide.set(quote.side, list)
  }
  const pairs: Array<[string, string]> = [
    ["casa", "fora"],
    ["over", "under"],
  ]
  let winner: { left: BoardQuote; right: BoardQuote; market: string; eventId: string; eventName: string; sportName: string; sportImage: string; phase: "prelive" | "live"; profit: number } | null = null
  for (const [sideA, sideB] of pairs) {
    const lefts = bySide.get(sideA) ?? []
    const rights = bySide.get(sideB) ?? []
    for (const left of lefts) {
      for (const right of rights) {
        if (left.houseId === right.houseId) continue
        const profit = profitOf(left.odd, right.odd)
        if (!profit) continue
        if (!winner || profit.profitPercent > winner.profit) {
          winner = {
            left,
            right,
            market: left.market,
            eventId: left.eventId,
            eventName: left.eventName,
            sportName: left.sportName,
            sportImage: left.sportImage,
            phase: left.phase,
            profit: profit.profitPercent,
          }
        }
      }
    }
  }
  return winner
}

export function signalKeyOf(signal: Pick<BoardSignal, "key">) {
  return signal.key
}
