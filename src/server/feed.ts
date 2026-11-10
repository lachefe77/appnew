import { prisma } from "@/lib/db"
import { refreshRealFeeds } from "@/server/feeds/refresh"
import { matchKey } from "@/server/match"
import { buildSignals, type BoardOptions, type BoardQuote, type BoardSignal } from "@/server/surebet"
import { getSettings } from "@/server/settings"

export type RealRow = {
  key: string
  eventName: string
  sportName: string
  sportImage: string
  phase: "prelive" | "live"
  market: string
  houseName: string
  houseSlug: string
  logoUrl: string
  feed: string
  sideA: string
  oddA: number
  sideB: string
  oddB: number
}

const liveCycle = [2.2, 2.1, 2.0, 1.95, 1.9, 1.85]
let liveStep = 0

export async function nudgeLiveDemo() {
  const odd = liveCycle[liveStep % liveCycle.length]
  liveStep += 1
  await prisma.quote.updateMany({
    where: { side: "fora", event: { externalId: "live-demo" } },
    data: { odd },
  })
}

export function readRates(settings: { get(key: string): string }) {
  const usd = Number(settings.get("fx.usdBrl").replace(",", "."))
  const eur = Number(settings.get("fx.eurBrl").replace(",", "."))
  return {
    USD: Number.isFinite(usd) && usd > 0 ? usd : 5.4,
    EUR: Number.isFinite(eur) && eur > 0 ? eur : 6.2,
  }
}

export async function suggestedStakeCents(userId: string) {
  const settings = await getSettings()
  const percent = Number(settings.get("stake.percent").replace(",", "."))
  const share = Number.isFinite(percent) && percent > 0 ? percent : 10
  const bankroll = await prisma.bankroll.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } })
  const balance = bankroll?.balanceCents ?? 0
  return Math.max(0, Math.round((balance * share) / 100))
}

export async function loadSignals(input: {
  phase: "prelive" | "live"
  options: Omit<BoardOptions, "totalStakeCents" | "rates" | "highlightAbove" | "minProfit"> & {
    totalStakeCents?: number | null
    minProfit?: number
  }
  userId: string
  simulate?: boolean
  refresh?: boolean
}) {
  const settings = await getSettings()
  if (input.refresh) await refreshRealFeeds()
  if (input.simulate !== false && settings.flag("signal.simulateLive") && input.phase === "live") {
    await nudgeLiveDemo()
  }
  const maxAgeSeconds = Number(settings.get("quote.maxAgeSeconds").replace(",", "."))
  const maxAge = Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0 ? maxAgeSeconds : 180
  const windowMinutes = Number(settings.get("quote.matchWindowMinutes").replace(",", "."))
  const matchWindow = Number.isFinite(windowMinutes) && windowMinutes > 0 ? windowMinutes : 90
  const aliases = await prisma.nameAlias.findMany()
  const aliasMap = new Map(aliases.map((alias) => [`${alias.kind}:${alias.source}`, alias.target]))
  const now = Date.now()
  const quotes = await prisma.quote.findMany({
    where: {
      phase: input.phase,
      house: { active: true, operable: true },
    },
    include: { house: true, event: { include: { sport: true } } },
  })
  const fresh = quotes.filter((quote) => {
    if (quote.source !== "publico") return true
    return now - quote.updatedAt.getTime() <= maxAge * 1000
  })
  const boardQuotes: BoardQuote[] = fresh.map((quote) => ({
    eventId: quote.eventId,
    eventName: quote.event.name,
    sportName: quote.event.sport.name,
    sportImage: quote.event.sport.imageUrl,
    phase: quote.phase === "live" ? "live" : "prelive",
    market: quote.market,
    houseId: quote.houseId,
    houseName: quote.house.name,
    houseSlug: quote.house.slug,
    logoUrl: quote.house.logoUrl,
    currency: quote.house.currency,
    cloneLabel: quote.house.cloneLabel,
    feed: quote.house.feed || quote.source,
    side: quote.side,
    odd: Number(quote.odd),
    competition: quote.event.competition,
    startsAt: quote.event.startsAt?.toISOString() ?? null,
    firstSeenAt: quote.firstSeenAt.toISOString(),
    updatedAt: quote.updatedAt.toISOString(),
    stakeStepCents: quote.house.stakeStepCents,
    minStakeCents: quote.house.minStakeCents,
    maxStakeCents: quote.house.maxStakeCents,
    houseUrl: quote.house.url,
    feedNote: quote.house.feed === "ao_vivo" ? "" : quote.house.lastError,
    matchKey: matchKey({
      eventId: quote.eventId,
      sport: quote.event.sport.name,
      name: quote.event.name,
      competition: quote.event.competition,
      startsAt: quote.event.startsAt,
      windowMinutes: matchWindow,
      aliases: aliasMap,
    }),
  }))
  const total = input.options.totalStakeCents && input.options.totalStakeCents > 0
    ? input.options.totalStakeCents
    : await suggestedStakeCents(input.userId)
  const highlight = Number(settings.get("signal.highlightPercent").replace(",", "."))
  const signals = buildSignals(boardQuotes, {
    ...input.options,
    totalStakeCents: total,
    rates: readRates(settings),
    highlightAbove: Number.isFinite(highlight) ? highlight : 7,
    minProfit: input.options.minProfit ?? (Number(settings.get("signal.minProfit").replace(",", ".")) || 0),
  })
  return { signals, realRows: realRowsFrom(quotes, signals), totalStakeCents: total }
}

function realRowsFrom(
  quotes: Array<{
    eventId: string
    market: string
    side: string
    odd: { toString(): string } | number
    phase: string
    source: string
    house: { feed: string; name: string; slug: string; logoUrl: string }
    event: { name: string; sport: { name: string; imageUrl: string } }
  }>,
  signals: BoardSignal[],
): RealRow[] {
  const used = new Set(signals.flatMap((signal) => signal.eventIds ?? [signal.eventId]))
  const groups = new Map<string, typeof quotes>()
  for (const quote of quotes) {
    if (quote.house.feed !== "ao_vivo" || quote.source !== "publico" || used.has(quote.eventId)) continue
    const key = `${quote.eventId}:${quote.house.slug}:${quote.market}`
    const list = groups.get(key) ?? []
    list.push(quote)
    groups.set(key, list)
  }
  const rows: RealRow[] = []
  const perHouse = new Map<string, number>()
  for (const [key, list] of groups) {
    if (list.length < 2) continue
    const [first, second] = list
    const seen = perHouse.get(first.house.slug) ?? 0
    if (seen >= 4) continue
    perHouse.set(first.house.slug, seen + 1)
    rows.push({
      key,
      eventName: first.event.name,
      sportName: first.event.sport.name,
      sportImage: first.event.sport.imageUrl,
      phase: first.phase === "live" ? "live" : "prelive",
      market: first.market,
      houseName: first.house.name,
      houseSlug: first.house.slug,
      logoUrl: first.house.logoUrl,
      feed: "ao_vivo",
      sideA: first.side,
      oddA: Number(first.odd),
      sideB: second.side,
      oddB: Number(second.odd),
    })
    if (rows.length >= 32) break
  }
  return rows
}

export async function findSignalByKey(userId: string, phase: "prelive" | "live", key: string, options: Parameters<typeof loadSignals>[0]["options"]) {
  const loaded = await loadSignals({ userId, phase, options, simulate: false })
  return { signal: loaded.signals.find((item) => item.key === key) ?? null, totalStakeCents: loaded.totalStakeCents }
}

export type { BoardSignal }
