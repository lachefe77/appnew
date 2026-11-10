import { describe, expect, it } from "vitest"
import { offersFromBc } from "@/server/feeds/bcgame"
import { americanToDecimal } from "@/server/feeds/odds"
import { offersFromSport } from "@/server/feeds/pinnacle"
import { offersFromPs, ps3838Ready, pullPs3838 } from "@/server/feeds/ps3838"

describe("fontes", () => {
  it("converte odd americana", () => {
    expect(americanToDecimal(-114)).toBeCloseTo(1.877, 3)
    expect(americanToDecimal(501)).toBeCloseTo(6.01, 2)
    expect(americanToDecimal(1.91)).toBe(1.91)
  })

  it("lê um evento real no formato da Pinnacle", () => {
    const offers = offersFromSport(
      "tenis",
      [
        {
          id: 10,
          isLive: false,
          startTime: "2026-11-12T18:00:00Z",
          participants: [
            { id: 1, alignment: "home", name: "A. Example" },
            { id: 2, alignment: "away", name: "B. Example" },
          ],
        },
      ],
      [
        {
          matchupId: 10,
          period: 0,
          type: "moneyline",
          prices: [
            { designation: "home", price: -114 },
            { designation: "away", price: -104 },
          ],
        },
      ],
    )
    expect(offers).toHaveLength(2)
    expect(offers[0].name).toBe("A. Example x B. Example")
    expect(offers[0].externalId).toBe("pin:10")
    expect(offers.map((item) => item.side).sort()).toEqual(["casa", "fora"])
    expect(offers.every((item) => item.odd > 1)).toBe(true)
  })

  it("a Ps3838 sem senha não chama a rede", async () => {
    let called = false
    const result = await pullPs3838("vazio", "vazio", async () => {
      called = true
      return { status: 200, body: "{}" }
    })
    expect(called).toBe(false)
    expect(result.needsCredential).toBe(true)
    expect(ps3838Ready("conta", "segredo")).toBe(true)
  })

  it("lê moneyline decimal da Ps3838", () => {
    const offers = offersFromPs(
      "basquete",
      [{ events: [{ id: 7, home: "Lakers", away: "Celtics", starts: "2026-11-12T00:00:00Z", liveStatus: 0 }] }],
      [{ events: [{ id: 7, periods: [{ number: 0, moneyline: { home: 1.91, away: 1.95 } }] }] }],
    )
    expect(offers.map((item) => item.odd).sort()).toEqual([1.91, 1.95])
    expect(offers[0].externalId).toBe("ps:7")
  })

  it("lê a Bcgame quando a fonte devolve evento", () => {
    const offers = offersFromBc([
      {
        id: "99",
        desc: { sport: { name: "Soccer" }, competitors: [{ name: "Alpha" }, { name: "Beta" }], scheduled: 1760000000 },
        markets: { "1": { "": { k: "1.85" }, x: { k: "2.10" } } },
      },
    ])
    expect(offers).toHaveLength(2)
    expect(offers[0].name).toBe("Alpha x Beta")
    expect(offers[0].sportSlug).toBe("futebol")
  })
})
