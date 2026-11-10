export const HOUSE_SEED = [
  { slug: "bcgame", name: "Bcgame", currency: "USD", cloneLabel: "", cloneOf: "", sortOrder: 1 },
  { slug: "pinnacle", name: "Pinnacle.com", currency: "EUR", cloneLabel: "Pinnacle", cloneOf: "", sortOrder: 2 },
  { slug: "ps3838", name: "Ps3838", currency: "EUR", cloneLabel: "Pinnacle", cloneOf: "pinnacle", sortOrder: 3 },
  { slug: "betonline", name: "Betonline", currency: "USD", cloneLabel: "", cloneOf: "", sortOrder: 4 },
  { slug: "bet365arg", name: "Bet365Arg", currency: "USD", cloneLabel: "Bet365", cloneOf: "", sortOrder: 5 },
  { slug: "bet365pe", name: "Bet365Pe", currency: "USD", cloneLabel: "Bet365", cloneOf: "", sortOrder: 6 },
  { slug: "cloudbet", name: "Cloudbet", currency: "EUR", cloneLabel: "", cloneOf: "", sortOrder: 7 },
  { slug: "fortunejack", name: "Fortunejack", currency: "USD", cloneLabel: "Blaze", cloneOf: "", sortOrder: 8 },
  { slug: "sbobet", name: "Sbobet", currency: "BRL", cloneLabel: "", cloneOf: "", sortOrder: 9 },
  { slug: "stake", name: "Stake.com", currency: "USD", cloneLabel: "", cloneOf: "", sortOrder: 10 },
  { slug: "winamaxes", name: "WinamaxES", currency: "EUR", cloneLabel: "", cloneOf: "", sortOrder: 11 },
] as const

export const SPORT_SEED = [
  { slug: "futebol", name: "Futebol" },
  { slug: "basquete", name: "Basquete" },
  { slug: "tenis", name: "Tênis" },
  { slug: "volei", name: "Vôlei" },
] as const

export const EVENT_SEED = [
  { externalId: "fut-classico", sport: "futebol", name: "Flamengo x Palmeiras", phase: "prelive" as const },
  { externalId: "nba-classico", sport: "basquete", name: "Lakers x Celtics", phase: "prelive" as const },
  { externalId: "live-demo", sport: "futebol", name: "Real Madrid x Barcelona", phase: "live" as const },
  { externalId: "tenis-extra", sport: "tenis", name: "Sinner x Alcaraz", phase: "prelive" as const },
  { externalId: "teste-ps-bc", sport: "basquete", name: "Teste Ps3838 x Teste Bcgame", phase: "prelive" as const },
]

export const QUOTE_SEED = [
  { event: "fut-classico", house: "pinnacle", market: "Resultado", side: "casa", odd: 2.05, phase: "prelive" as const },
  { event: "fut-classico", house: "stake", market: "Resultado", side: "fora", odd: 2.05, phase: "prelive" as const },
  { event: "nba-classico", house: "betonline", market: "Resultado", side: "casa", odd: 2.16, phase: "prelive" as const },
  { event: "nba-classico", house: "winamaxes", market: "Resultado", side: "fora", odd: 2.16, phase: "prelive" as const },
  { event: "live-demo", house: "pinnacle", market: "Resultado", side: "casa", odd: 2.05, phase: "live" as const },
  { event: "live-demo", house: "stake", market: "Resultado", side: "fora", odd: 2.2, phase: "live" as const },
  { event: "tenis-extra", house: "bcgame", market: "Resultado", side: "casa", odd: 1.7, phase: "prelive" as const },
  { event: "tenis-extra", house: "sbobet", market: "Resultado", side: "fora", odd: 1.8, phase: "prelive" as const },
  { event: "teste-ps-bc", house: "ps3838", market: "Resultado", side: "casa", odd: 2.05, phase: "prelive" as const },
  { event: "teste-ps-bc", house: "bcgame", market: "Resultado", side: "fora", odd: 2.05, phase: "prelive" as const },
]

export const OPERATOR_EMAIL = "operador@futsurebet.com"
export const OPERATOR_PASSWORD = "Operador#2026"
