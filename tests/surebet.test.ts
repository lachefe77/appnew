import { describe, expect, it } from "vitest"
import { buildSignals, profitOf, stakesFor, toHouseCents, type BoardQuote } from "@/server/surebet"

function quote(partial: Partial<BoardQuote> & Pick<BoardQuote, "houseId" | "side" | "odd">): BoardQuote {
  return {
    eventId: "jogo",
    eventName: "Flamengo x Palmeiras",
    sportName: "Futebol",
    sportImage: "/esportes/futebol.svg",
    phase: "prelive",
    market: "Resultado",
    houseName: partial.houseId,
    houseSlug: partial.houseId,
    logoUrl: "/marcas/stake.svg",
    currency: "BRL",
    cloneLabel: "",
    feed: "fixture",
    ...partial,
  }
}

describe("motor de surebet", () => {
  it("fecha 2,50% com odds 2,05 e 2,05", () => {
    const stakes = stakesFor(10000, 2.05, 2.05)
    expect(stakes).not.toBeNull()
    expect(stakes!.stake1 + stakes!.stake2).toBe(10000)
    expect(stakes!.stake1).toBe(5000)
    expect(stakes!.stake2).toBe(5000)
    expect(stakes!.profitCents).toBe(250)
    expect(stakes!.profitPercent).toBeCloseTo(2.5, 2)
  })

  it("destaca lucro acima de 7%", () => {
    const stakes = stakesFor(10000, 2.16, 2.16)
    expect(stakes!.profitPercent).toBeCloseTo(8, 2)
    expect(stakes!.profitCents).toBe(800)
    const signals = buildSignals(
      [
        quote({ houseId: "a", houseName: "Betonline", side: "casa", odd: 2.05 }),
        quote({ houseId: "b", houseName: "Stake.com", side: "fora", odd: 2.05 }),
        quote({
          eventId: "nba",
          eventName: "Lakers x Celtics",
          sportName: "Basquete",
          houseId: "c",
          houseName: "WinamaxES",
          side: "casa",
          odd: 2.16,
        }),
        quote({
          eventId: "nba",
          eventName: "Lakers x Celtics",
          sportName: "Basquete",
          houseId: "d",
          houseName: "Pinnacle.com",
          side: "fora",
          odd: 2.16,
        }),
      ],
      { totalStakeCents: 10000, rates: { USD: 5.4, EUR: 6.2 }, highlightAbove: 7 },
    )
    const low = signals.find((signal) => signal.eventName.includes("Flamengo"))
    const high = signals.find((signal) => signal.eventName.includes("Lakers"))
    expect(low?.highlight).toBe(false)
    expect(high?.highlight).toBe(true)
    expect(low?.profitPercent).toBeCloseTo(2.5, 2)
    expect(high?.profitPercent).toBeCloseTo(8, 2)
  })

  it("ignora par que não fecha surebet", () => {
    expect(profitOf(1.7, 1.8)).toBeNull()
    const signals = buildSignals(
      [quote({ houseId: "a", side: "casa", odd: 1.7 }), quote({ houseId: "b", side: "fora", odd: 1.8 })],
      { totalStakeCents: 10000, rates: { USD: 5.4, EUR: 6.2 } },
    )
    expect(signals).toHaveLength(0)
  })

  it("respeita lado fixo, casa fixada e converte moeda", () => {
    const quotes = [
      quote({ houseId: "pin", houseName: "Pinnacle.com", currency: "EUR", side: "casa", odd: 2.05 }),
      quote({ houseId: "stk", houseName: "Stake.com", currency: "USD", side: "fora", odd: 2.05 }),
    ]
    const blocked = buildSignals(quotes, {
      totalStakeCents: 10000,
      rates: { USD: 5.4, EUR: 6.2 },
      fixedSides: { pin: "fora" },
    })
    expect(blocked).toHaveLength(0)
    const pinned = buildSignals(
      [
        ...quotes,
        quote({ eventId: "outro", eventName: "Outro jogo", houseId: "x", side: "casa", odd: 2.2 }),
        quote({ eventId: "outro", eventName: "Outro jogo", houseId: "y", side: "fora", odd: 2.2 }),
      ],
      { totalStakeCents: 10000, rates: { USD: 5.4, EUR: 6.2 }, pinnedHouseId: "pin" },
    )
    expect(pinned).toHaveLength(1)
    expect(pinned[0].leg1.houseId === "pin" || pinned[0].leg2.houseId === "pin").toBe(true)
    expect(toHouseCents(5000, "USD", { USD: 5.4, EUR: 6.2 })).toBe(926)
    expect(toHouseCents(5000, "BRL", { USD: 5.4, EUR: 6.2 })).toBe(5000)
  })

  it("com auto-mercado fica o melhor mercado do evento", () => {
    const signals = buildSignals(
      [
        quote({ houseId: "pin", houseName: "Pinnacle.com", market: "Resultado", side: "casa", odd: 2.05 }),
        quote({ houseId: "stk", houseName: "Stake.com", market: "Resultado", side: "fora", odd: 2.05 }),
        quote({ houseId: "pin", houseName: "Pinnacle.com", market: "Gols", side: "over", odd: 2.16 }),
        quote({ houseId: "stk", houseName: "Stake.com", market: "Gols", side: "under", odd: 2.16 }),
      ],
      { totalStakeCents: 10000, rates: { USD: 5.4, EUR: 6.2 }, autoMarketHouseIds: ["pin"] },
    )
    expect(signals).toHaveLength(1)
    expect(signals[0].market).toBe("Gols")
    expect(signals[0].profitPercent).toBeCloseTo(8, 2)
  })
})
