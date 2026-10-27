import { SupplierSource } from "@prisma/client";
import { getCommerce } from "./commerce";
import { formatMoney } from "@/lib/format";
import { notifyAdmin } from "./notifications";
import { prisma } from "./db";
import { getSetting, setSetting } from "./settings";
import { adapterFor } from "./suppliers";
import { expireDueCharges } from "./charges";

export async function runWatchdog() {
  await expireDueCharges();
  const commerce = await getCommerce();
  for (const source of [SupplierSource.CJ_BRAZIL, SupplierSource.BLING_HUB]) {
    const balance = await adapterFor(source).getMasterBalance();
    const threshold = balance.currency === "USD" ? commerce.cjLowBalanceCents : commerce.lowBalanceCents;
    const key = `low_balance_${source}`;
    const state = await getSetting<{ alerted: boolean }>(key, { alerted: false });
    await prisma.balanceSnapshot.create({
      data: { source, balanceCents: balance.cents, currency: balance.currency },
    });
    const money = formatMoney(balance.cents, balance.currency);
    const limit = formatMoney(threshold, balance.currency);
    if (balance.cents < threshold && !state.alerted) {
      await notifyAdmin(
        "Saldo mestre baixo",
        `${source} está com ${money}. O limite configurado é ${limit}. Reponha o saldo no fornecedor antes de novos despachos.`,
      );
      await setSetting(key, { alerted: true });
    } else if (balance.cents >= threshold && state.alerted) {
      await setSetting(key, { alerted: false });
      await notifyAdmin("Saldo mestre reposto", `${source} voltou a ${money}.`, "info");
    }
  }
  await setSetting("watchdog_last_run", { at: new Date().toISOString() });
}
