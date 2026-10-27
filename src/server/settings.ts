import { prisma } from "./db";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return fallback;
  return row.valueJson as T;
}

export async function setSetting(key: string, value: unknown) {
  await prisma.setting.upsert({
    where: { key },
    create: { key, valueJson: value as object },
    update: { valueJson: value as object },
  });
}

export type BalanceSetting = { cents: number; currency: "BRL" | "USD" };
export type PauseSetting = { paused: boolean; reason: string | null };

const balanceKey = {
  CJ_BRAZIL: "cj_master_balance_cents",
  BLING_HUB: "bling_master_balance_cents",
} as const;

export async function getMasterBalance(source: keyof typeof balanceKey): Promise<BalanceSetting> {
  return getSetting<BalanceSetting>(balanceKey[source], { cents: 0, currency: source === "CJ_BRAZIL" ? "USD" : "BRL" });
}

export async function setMasterBalance(source: keyof typeof balanceKey, value: BalanceSetting) {
  await setSetting(balanceKey[source], value);
}

export async function getPause(): Promise<PauseSetting> {
  return getSetting<PauseSetting>("fulfillment_paused", { paused: false, reason: null });
}

export async function setPause(value: PauseSetting) {
  await setSetting("fulfillment_paused", value);
}
