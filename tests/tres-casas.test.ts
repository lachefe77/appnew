import { expect, it } from "vitest"
import { offersFromGiro } from "@/server/feeds/girocerto"
import { pull99play, pullBingoemcasa } from "@/server/feeds/status"

it("lê resultado de duas pontas e total da Giro Certo, e ignora o 1x2 com empate", () => {
  const offers = offersFromGiro(
    [
      {
        id: "fut",
        sport: "football",
        league: { name: "Amistosos" },
        home: { name: "Vietnam" },
        away: { name: "Chinese Taipei" },
        startsAt: "2026-11-11T12:00:00.000Z",
        markets: [
          {
            kind: "winner",
            outcomes: [
              { key: "home", odds: 1.16 },
              { key: "draw", odds: 6.98 },
              { key: "away", odds: 14.96 },
            ],
          },
          {
            kind: "total",
            outcomes: [
              { key: "over", odds: 1.28 },
              { key: "under", odds: 3.45 },
            ],
          },
        ],
      },
      {
        id: "nba",
        sport: "basketball",
        home: { name: "MIL Bucks" },
        away: { name: "NY Knicks" },
        startsAt: "2026-11-10T23:30:00.000Z",
        markets: [
          {
            kind: "winner",
            outcomes: [
              { key: "home", odds: 1.84 },
              { key: "away", odds: 1.98 },
            ],
          },
        ],
      },
    ],
    "prelive",
  )
  expect(offers.map((offer) => `${offer.externalId}:${offer.market}:${offer.side}`)).toEqual([
    "gc:fut:Total:over",
    "gc:fut:Total:under",
    "gc:nba:Resultado:casa",
    "gc:nba:Resultado:fora",
  ])
  expect(offers[0].competition).toBe("Amistosos")
  expect(offers[2].name).toBe("MIL Bucks x NY Knicks")
})

it("registra 99play e Bingo em Casa sem odd quando a fonte não entrega", async () => {
  const play = await pull99play(async () => ({ status: 403, body: "blocked" }))
  const bingo = await pullBingoemcasa(async () => ({ status: 401, body: "" }))
  expect(play.ok).toBe(false)
  expect(play.detail).toContain("HTTP 403")
  expect(bingo.ok).toBe(false)
  expect(bingo.detail).toContain("HTTP 401")
})
