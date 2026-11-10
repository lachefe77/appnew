import { expect, it } from "vitest"
import { offersFromEvents } from "@/server/feeds/cloudbet"
import { pullBlocked } from "@/server/feeds/status"

it("lê vencedor e total da Cloudbet", () => {
  const winner = offersFromEvents(
    "basquete",
    [
      {
        id: 42,
        status: "TRADING_LIVE",
        startTime: "2026-11-10T18:00:00Z",
        home: { name: "Knicks" },
        away: { name: "Bucks" },
        markets: {
          "basketball.moneyline": {
            submarkets: {
              ft: {
                selections: [
                  { outcome: "home", price: 1.91, status: "SELECTION_ENABLED" },
                  { outcome: "away", price: 1.95, status: "SELECTION_ENABLED" },
                ],
              },
            },
          },
        },
      },
    ],
    "basketball.moneyline",
    "winner",
  )
  expect(winner).toHaveLength(2)
  expect(winner[0].phase).toBe("live")
  expect(winner[0].name).toBe("Knicks x Bucks")
  expect(winner[0].externalId).toBe("cb:42")

  const total = offersFromEvents(
    "futebol",
    [
      {
        id: 7,
        status: "TRADING",
        home: { name: "City" },
        away: { name: "Fulham" },
        markets: {
          "soccer.total_goals": {
            submarkets: {
              ft: {
                selections: [
                  { outcome: "over", params: "total=2.5", price: 1.8 },
                  { outcome: "under", params: "total=2.5", price: 2.0 },
                  { outcome: "over", params: "total=3.5", price: 3.2 },
                  { outcome: "under", params: "total=3.5", price: 1.3 },
                ],
              },
            },
          },
        },
      },
    ],
    "soccer.total_goals",
    "total",
  )
  expect(total.map((item) => item.side).sort()).toEqual(["over", "under"])
  expect(total.every((item) => item.odd === 1.8 || item.odd === 2)).toBe(true)
})

it("registra HTTP 403 sem trocar a odd de teste", async () => {
  const result = await pullBlocked("stake", async () => ({ status: 403, body: "blocked" }))
  expect(result.ok).toBe(false)
  expect(result.offers).toHaveLength(0)
  expect(result.detail).toContain("HTTP 403")
  const open = await pullBlocked("sbobet", async () => ({ status: 200, body: "<html></html>" }))
  expect(open.ok).toBe(false)
  expect(open.detail).toContain("sem feed de odds")
  expect(result.needsCredential).toBeUndefined()
})
