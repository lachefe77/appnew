import { SupplierSource } from "@prisma/client";
import { config } from "./config";
import { notifyAdmin } from "./notifications";
import { getSetting, setSetting } from "./settings";
import { adapterFor } from "./suppliers";
import { expireDueCharges } from "./charges";

export async function runWatchdog() {
  await expireDueCharges();
  for (const source of [SupplierSource.CJ_BRAZIL, SupplierSource.BLING_HUB]) {
    const balance = await adapterFor(source).getMasterBalance();
    const threshold = balance.currency === "USD" ? config.cjLowBalanceCents : config.lowBalanceCents;
    const key = `low_balance_${source}`;
    const state = await getSetting<{ alerted: boolean }>(key, { alerted: false });
    if (balance.cents < threshold && !state.alerted) {
      await notifyAdmin(
        "Saldo mestre baixo",
        `${source} está com ${balance.cents} centavos em ${balance.currency}. O limite configurado é ${threshold}. Reponha o saldo no fornecedor antes de novos despachos.`,
      );
      await setSetting(key, { alerted: true });
    } else if (balance.cents >= threshold && state.alerted) {
      await setSetting(key, { alerted: false });
      await notifyAdmin("Saldo mestre reposto", `${source} voltou a ${balance.cents} centavos (${balance.currency}).`, "info");
    }
  }
  await setSetting("watchdog_last_run", { at: new Date().toISOString() });
}
