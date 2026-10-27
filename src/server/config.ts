import "./env-file";

function numberFrom(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return value;
}

function flag(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return raw === "true" || raw === "1";
}

export const config = {
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  authSecret: process.env.AUTH_SECRET ?? "",
  webhookSecret: process.env.WEBHOOK_SECRET ?? "",
  paymentProvider: (process.env.PAYMENT_PROVIDER ?? "sandbox") as "sandbox" | "asaas" | "openpix",
  supplierMode: (process.env.SUPPLIER_MODE ?? "sandbox") as "sandbox" | "live",
  inlineJobs: flag("INLINE_JOBS", false),
  spread: numberFrom("PLATFORM_SPREAD", 1.35),
  retailMultiplier: numberFrom("RETAIL_MULTIPLIER", 2.5),
  lowBalanceCents: numberFrom("LOW_BALANCE_THRESHOLD_CENTS", 200_000),
  cjLowBalanceCents: numberFrom("CJ_LOW_BALANCE_THRESHOLD_CENTS", 40_000),
  minDepositCents: numberFrom("MIN_DEPOSIT_CENTS", 15_000),
  abandonedPixDelayMs: numberFrom("ABANDONED_PIX_DELAY_MS", 420_000),
  pixExpiresMinutes: numberFrom("PIX_EXPIRES_MINUTES", 30),
  watchdogIntervalMs: numberFrom("WATCHDOG_INTERVAL_MS", 600_000),
  lowStockThreshold: numberFrom("LOW_STOCK_THRESHOLD", 5),
  usdBrlRate: numberFrom("USD_BRL_RATE", 5.4),
  redisUrl: process.env.REDIS_URL ?? "",
  asaasApiKey: process.env.ASAAS_API_KEY ?? "",
  asaasApiUrl: process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3",
  asaasWebhookToken: process.env.ASAAS_WEBHOOK_TOKEN ?? "",
  openPixAppId: process.env.OPENPIX_APP_ID ?? "",
  openPixApiUrl: process.env.OPENPIX_API_URL ?? "https://api.openpix.com.br/api/v1",
  openPixWebhookSecret: process.env.OPENPIX_WEBHOOK_SECRET ?? "",
  cjApiKey: process.env.CJ_API_KEY ?? "",
  cjApiUrl: process.env.CJ_API_URL ?? "https://developers.cjdropshipping.com/api2.0/v1",
  cjLogisticName: process.env.CJ_LOGISTIC_NAME ?? "",
  cjFromCountry: process.env.CJ_FROM_COUNTRY ?? "BR",
  blingClientId: process.env.BLING_CLIENT_ID ?? "",
  blingClientSecret: process.env.BLING_CLIENT_SECRET ?? "",
  blingRefreshToken: process.env.BLING_REFRESH_TOKEN ?? "",
  blingApiUrl: process.env.BLING_API_URL ?? "https://api.bling.com.br/Api/v3",
  evolutionUrl: process.env.EVOLUTION_API_URL ?? "",
  evolutionKey: process.env.EVOLUTION_API_KEY ?? "",
  evolutionInstance: process.env.EVOLUTION_INSTANCE ?? "novos-horizontes",
  recoveryAudioUrl: process.env.RECOVERY_AUDIO_URL ?? "",
  recoveryAudioPtt: flag("RECOVERY_AUDIO_PTT", false),
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
};

export function assertSecrets() {
  if (process.env.NODE_ENV === "production") {
    if (config.authSecret.length < 32 || config.authSecret.startsWith("troque-")) {
      throw new Error("AUTH_SECRET fraco para produção");
    }
    if (config.webhookSecret.length < 16 || config.webhookSecret.startsWith("troque-")) {
      throw new Error("WEBHOOK_SECRET fraco para produção");
    }
    if (config.paymentProvider === "sandbox" || config.supplierMode === "sandbox") {
      throw new Error("Sandbox não pode subir com NODE_ENV=production");
    }
  }
}

export function isSandboxPayment() {
  return config.paymentProvider === "sandbox";
}

export function isSandboxSupplier() {
  return config.supplierMode === "sandbox";
}
