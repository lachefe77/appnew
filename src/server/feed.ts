import { prisma } from "@/lib/db"
import { buildSignals, type BoardOptions, type BoardQuote, type BoardSignal } from "@/server/surebet"
import { getSettings } from "@/server/settings"

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
}) {
  const settings = await getSettings()
  if (input.simulate !== false && settings.flag("signal.simulateLive") && input.phase === "live") {
    await nudgeLiveDemo()
  }
  const quotes = await prisma.quote.findMany({
    where: {
      phase: input.phase,
      house: { active: true, operable: true },
    },
    include: { house: true, event: { include: { sport: true } } },
  })
  const boardQuotes: BoardQuote[] = quotes.map((quote) => ({
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
  return { signals, totalStakeCents: total }
}

export async function findSignalByKey(userId: string, phase: "prelive" | "live", key: string, options: Parameters<typeof loadSignals>[0]["options"]) {
  const loaded = await loadSignals({ userId, phase, options, simulate: false })
  return { signal: loaded.signals.find((item) => item.key === key) ?? null, totalStakeCents: loaded.totalStakeCents }
}

export type { BoardSignal }
