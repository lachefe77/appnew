import { getSetting, setSetting } from "./settings";

export type StoreBrand = {
  name: string;
  mark: string;
  tagline: string;
  heroTitle: string;
  heroBody: string;
  dispatchLabel: string;
  warehouseLabel: string;
  supplierLabel: string;
  shippingLabel: string;
  supportEmail: string;
  usdtAddress: string;
  usdtNetwork: string;
  usdtBrlCents: number;
  affiliateBps: number;
};

export function brandDefaults(): StoreBrand {
  return {
    name: "Mestre do Atacadão",
    mark: "MA",
    tagline: "Atacado com galpão no Brasil",
    heroTitle: "Atacado de uma unidade, com despacho em 24 horas.",
    heroBody: "Ferramentas, bem-estar e pet. O pagamento é PIX, boleto ou USDT. Não trabalhamos com cartão. O pedido sai do galpão quando o pagamento confirma.",
    dispatchLabel: "Despacha em 24 horas",
    warehouseLabel: "Temos galpão",
    supplierLabel: "Fornecedor rápido",
    shippingLabel: "Enviamos para todo o Brasil",
    supportEmail: "suporte@mestredoatacadao.test",
    usdtAddress: "TDEMOMESTREDOATACADAOUSDT0001",
    usdtNetwork: "TRC20",
    usdtBrlCents: 550,
    affiliateBps: 200,
  };
}

export async function getBrand(): Promise<StoreBrand> {
  const stored = await getSetting<Partial<StoreBrand>>("storefront", {});
  const defaults = brandDefaults();
  return {
    name: text(stored.name, defaults.name, 60),
    mark: text(stored.mark, defaults.mark, 4).toUpperCase(),
    tagline: text(stored.tagline, defaults.tagline, 80),
    heroTitle: text(stored.heroTitle, defaults.heroTitle, 140),
    heroBody: text(stored.heroBody, defaults.heroBody, 400),
    dispatchLabel: text(stored.dispatchLabel, defaults.dispatchLabel, 80),
    warehouseLabel: text(stored.warehouseLabel, defaults.warehouseLabel, 80),
    supplierLabel: text(stored.supplierLabel, defaults.supplierLabel, 80),
    shippingLabel: text(stored.shippingLabel, defaults.shippingLabel, 80),
    supportEmail: text(stored.supportEmail, defaults.supportEmail, 120),
    usdtAddress: text(stored.usdtAddress, defaults.usdtAddress, 120),
    usdtNetwork: text(stored.usdtNetwork, defaults.usdtNetwork, 20),
    usdtBrlCents: cents(stored.usdtBrlCents, defaults.usdtBrlCents),
    affiliateBps: bps(stored.affiliateBps, defaults.affiliateBps),
  };
}

export async function saveBrand(patch: Partial<StoreBrand>) {
  const current = await getBrand();
  const next = { ...current, ...patch };
  await setSetting("storefront", next);
  return getBrand();
}

function text(value: unknown, fallback: string, max: number) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, max);
}

function cents(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 100 && number <= 100_000_00 ? number : fallback;
}

function bps(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 2000 ? number : fallback;
}
