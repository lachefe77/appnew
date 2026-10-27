import { config } from "./config";
import { getSetting, setSetting } from "./settings";

export type CommerceSettings = {
  spread: number;
  retailMultiplier: number;
  minDepositCents: number;
  abandonedPixDelayMs: number;
  lowBalanceCents: number;
  cjLowBalanceCents: number;
  lowStockThreshold: number;
  lowStockBadge: number;
  shipDays: number;
};

export function commerceDefaults(): CommerceSettings {
  return {
    spread: config.spread,
    retailMultiplier: config.retailMultiplier,
    minDepositCents: config.minDepositCents,
    abandonedPixDelayMs: config.abandonedPixDelayMs,
    lowBalanceCents: config.lowBalanceCents,
    cjLowBalanceCents: config.cjLowBalanceCents,
    lowStockThreshold: config.lowStockThreshold,
    lowStockBadge: 8,
    shipDays: 2,
  };
}

export async function getCommerce(): Promise<CommerceSettings> {
  const stored = await getSetting<Partial<CommerceSettings>>("commerce", {});
  const defaults = commerceDefaults();
  return {
    spread: positive(stored.spread, defaults.spread),
    retailMultiplier: positive(stored.retailMultiplier, defaults.retailMultiplier),
    minDepositCents: integer(stored.minDepositCents, defaults.minDepositCents),
    abandonedPixDelayMs: integer(stored.abandonedPixDelayMs, defaults.abandonedPixDelayMs),
    lowBalanceCents: integer(stored.lowBalanceCents, defaults.lowBalanceCents),
    cjLowBalanceCents: integer(stored.cjLowBalanceCents, defaults.cjLowBalanceCents),
    lowStockThreshold: integer(stored.lowStockThreshold, defaults.lowStockThreshold),
    lowStockBadge: integer(stored.lowStockBadge, defaults.lowStockBadge),
    shipDays: integer(stored.shipDays, defaults.shipDays),
  };
}

export async function saveCommerce(patch: Partial<CommerceSettings>) {
  const current = await getCommerce();
  const next = { ...current, ...patch };
  await setSetting("commerce", next);
  return next;
}

function positive(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function integer(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}
