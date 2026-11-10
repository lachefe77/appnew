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

export async function pull99play(get: FeedGet = httpGet): Promise<PullResult> {
  const url =
    "https://sb2frontend-altenar2.biahosted.com/api/widget/GetEvents?culture=pt-BR&integration=24games1&deviceType=1&sportId=66"
  try {
    const response = await get(url)
    return {
      ok: false,
      offers: [],
      detail: `HTTP ${response.status} no feed de odds da Altenar (integration 24games1). A página 99play.io/sports abre, mas a odd não chega daqui. Continua em teste. Sem login inventado.`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "falha de rede"
    return { ok: false, offers: [], detail: `HTTP falhou (${message}) no feed da Altenar da 99play. Continua em teste.` }
  }
}

export async function pullBingoemcasa(get: FeedGet = httpGet): Promise<PullResult> {
  const url = "https://www.bingoemcasa16.com/api/v1/user/get-user"
  try {
    const response = await get(url)
    return {
      ok: false,
      offers: [],
      detail: `HTTP ${response.status} em /api/v1/user/get-user. O esporte manda para o login. Sem feed público de odds. Continua em teste.`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "falha de rede"
    return { ok: false, offers: [], detail: `HTTP falhou (${message}) no esporte do Bingo em Casa. Continua em teste.` }
  }
}

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
