export type Offer = {
  externalId: string
  name: string
  sportSlug: "futebol" | "basquete" | "tenis" | "volei"
  phase: "prelive" | "live"
  market: string
  side: "casa" | "fora" | "over" | "under"
  odd: number
  startsAt: string | null
  competition?: string
}

export type PullResult = {
  ok: boolean
  offers: Offer[]
  detail: string
  needsCredential?: boolean
}

export type FeedGet = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ status: number; body: string }>

export async function httpGet(url: string, init?: { headers?: Record<string, string> }) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "FutSurebet/1.0",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(20000),
  })
  return { status: response.status, body: await response.text() }
}
