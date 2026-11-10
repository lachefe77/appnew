import { prisma } from "@/lib/db"
import { pullBcgame } from "@/server/feeds/bcgame"
import { pullCloudbet } from "@/server/feeds/cloudbet"
import { pullPinnacle } from "@/server/feeds/pinnacle"
import { pullPs3838 } from "@/server/feeds/ps3838"
import { BLOCKED_HOUSES, pullBlocked } from "@/server/feeds/status"
import type { Offer, PullResult } from "@/server/feeds/types"
import { getSettings } from "@/server/settings"

const SPORT_NAME = {
  futebol: "Futebol",
  basquete: "Basquete",
  tenis: "Tênis",
  volei: "Vôlei",
} as const

let lastRun = 0
let inflight: Promise<void> | null = null

export function refreshRealFeeds(force = false) {
  if (inflight) return inflight
  if (!force && Date.now() - lastRun < 60_000) return Promise.resolve()
  inflight = run()
    .catch(() => undefined)
    .finally(() => {
      inflight = null
      lastRun = Date.now()
    })
  return inflight
}

async function run() {
  const settings = await getSettings()
  await Promise.all([
    pullPinnacle().then((result) => applyHouse("pinnacle", result)),
    pullPs3838(settings.get("feed.ps3838.user"), settings.get("feed.ps3838.password")).then((result) =>
      applyHouse("ps3838", result),
    ),
    pullBcgame().then((result) => applyHouse("bcgame", result)),
    pullCloudbet().then((result) => applyHouse("cloudbet", result)),
    ...BLOCKED_HOUSES.map((house) => pullBlocked(house.slug).then((result) => applyHouse(house.slug, result))),
  ])
}

async function applyHouse(slug: string, result: PullResult) {
  const started = Date.now()
  const house = await prisma.house.findUnique({ where: { slug } })
  if (!house) return
  await prisma.setting.upsert({
    where: { key: `feed.${slug}.detail` },
    update: { value: result.detail.slice(0, 500) },
    create: { key: `feed.${slug}.detail`, label: slug, group: "feed", kind: "longtext", value: result.detail.slice(0, 500) },
  })
  if (!result.ok) {
    await prisma.house.update({
      where: { id: house.id },
      data: { lastError: result.detail.slice(0, 300) },
    })
    await prisma.feedRun.create({
      data: { houseSlug: slug, durationMs: Date.now() - started, ok: false, detail: result.detail.slice(0, 300) },
    })
    return
  }
  await replaceOffers(house.id, result.offers)
  await prisma.house.update({
    where: { id: house.id },
    data: { feed: "ao_vivo", lastGoodAt: new Date(), lastError: "" },
  })
  await prisma.feedRun.create({
    data: { houseSlug: slug, durationMs: Date.now() - started, ok: true, detail: result.detail.slice(0, 300) },
  })
}

export async function replaceOffers(houseId: string, offers: Offer[]) {
  const sports = new Map<string, string>()
  for (const slug of new Set(offers.map((offer) => offer.sportSlug))) {
    const sport = await prisma.sport.upsert({
      where: { slug },
      update: { imageUrl: `/esportes/${slug}.svg` },
      create: { slug, name: SPORT_NAME[slug], imageUrl: `/esportes/${slug}.svg` },
    })
    sports.set(slug, sport.id)
  }
  await prisma.quote.deleteMany({ where: { houseId } })
  const grouped = new Map<string, Offer[]>()
  for (const offer of offers) {
    const list = grouped.get(offer.externalId) ?? []
    list.push(offer)
    grouped.set(offer.externalId, list)
  }
  for (const [externalId, legs] of grouped) {
    const first = legs[0]
    const sportId = sports.get(first.sportSlug)
    if (!sportId) continue
    const existing = await prisma.event.findFirst({ where: { externalId } })
    const event = existing
      ? await prisma.event.update({
          where: { id: existing.id },
          data: {
            name: first.name,
            phase: first.phase,
            sportId,
            startsAt: first.startsAt ? new Date(first.startsAt) : null,
            competition: first.competition ?? "",
          },
        })
      : await prisma.event.create({
          data: {
            externalId,
            name: first.name,
            phase: first.phase,
            sportId,
            startsAt: first.startsAt ? new Date(first.startsAt) : null,
            competition: first.competition ?? "",
          },
        })
    for (const leg of legs) {
      await prisma.quote.upsert({
        where: { eventId_houseId_market_side: { eventId: event.id, houseId, market: leg.market, side: leg.side } },
        update: { odd: leg.odd, phase: leg.phase, source: "publico" },
        create: {
          eventId: event.id,
          houseId,
          market: leg.market,
          side: leg.side,
          odd: leg.odd,
          phase: leg.phase,
          source: "publico",
        },
      })
    }
  }
}
