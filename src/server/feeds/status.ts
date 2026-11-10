import { httpGet, type FeedGet, type PullResult } from "@/server/feeds/types"

export const BLOCKED_HOUSES = [
  { slug: "betonline", url: "https://api-offering-ext.betonline.ag/sports", label: "API pública de offering" },
  { slug: "bet365arg", url: "https://www.bet365.com.ar/", label: "site público" },
  { slug: "bet365pe", url: "https://www.bet365.pe/", label: "site público" },
  { slug: "fortunejack", url: "https://sports.fortunejack.com/", label: "site de esportes" },
  { slug: "sbobet", url: "https://www.sbobet.com/euro/football", label: "página pública" },
  { slug: "stake", url: "https://stake.com/sports/soccer", label: "página pública" },
  { slug: "winamaxes", url: "https://www.winamax.es/apuestas-deportivas", label: "página pública" },
] as const

export async function pullBlocked(slug: string, get: FeedGet = httpGet): Promise<PullResult> {
  const house = BLOCKED_HOUSES.find((item) => item.slug === slug)
  if (!house) return { ok: false, offers: [], detail: "Casa sem checagem." }
  try {
    const response = await get(house.url)
    if (response.status === 200) {
      return {
        ok: false,
        offers: [],
        detail: `HTTP 200 em ${house.label}, sem feed de odds. Continua em teste. Não há chave para colar.`,
      }
    }
    return {
      ok: false,
      offers: [],
      detail: `HTTP ${response.status} em ${house.label}. Fonte bloqueada. Continua em teste. Não há chave para colar.`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "falha de rede"
    return { ok: false, offers: [], detail: `HTTP falhou (${message}) em ${house.label}. Continua em teste.` }
  }
}
