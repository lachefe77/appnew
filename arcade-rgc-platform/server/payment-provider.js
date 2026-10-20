/**
 * PaymentProvider — abstração de depósito/saque.
 * PIX real OFF por padrão (409).
 * Asaas: implementado como stub sandbox (ASAAS_ENABLED=1 + ASAAS_API_KEY),
 * sem ativar money path até o operador configurar no painel.
 * Mock lab: development + ENABLE_SIMULATED_FUNDS=1.
 */

export class PaymentProvider {
  constructor({ simulation = false, name = "none", asaas = null } = {}) {
    this.simulation = Boolean(simulation);
    this.name = name;
    this.asaas = asaas;
  }

  async createDeposit({ userId, amountCents, idempotencyKey }) {
    if (this.asaas?.enabled) {
      return this.asaas.createDeposit({ userId, amountCents, idempotencyKey });
    }
    if (!this.simulation) {
      const err = new Error("PIX real ainda não está integrado.");
      err.status = 409;
      err.code = "PIX_OFF";
      throw err;
    }
    if (!userId || !(amountCents > 0)) {
      const err = new Error("Depósito inválido.");
      err.status = 400;
      throw err;
    }
    return {
      provider: this.name,
      status: "MOCK_APPROVED",
      userId,
      amountCents,
      idempotencyKey: idempotencyKey || null,
      pixPayload: null,
      mock: true,
    };
  }

  async createWithdraw({ userId, amountCents, pixKey }) {
    if (this.asaas?.enabled) {
      return this.asaas.createWithdraw({ userId, amountCents, pixKey });
    }
    if (!this.simulation) {
      const err = new Error("Saque PIX real desabilitado nesta versão.");
      err.status = 409;
      err.code = "PIX_OFF";
      throw err;
    }
    if (!userId || !(amountCents > 0) || !pixKey) {
      const err = new Error("Saque inválido.");
      err.status = 400;
      throw err;
    }
    return {
      provider: this.name,
      status: "MOCK_QUEUED",
      userId,
      amountCents,
      pixKey,
      mock: true,
    };
  }

  /** Webhook Asaas — preparado; sem ASAAS_ENABLED só registra. */
  async handleWebhook(body, token) {
    if (!this.asaas?.enabled) {
      return { ok: false, skipped: true, reason: "ASAAS_ENABLED off" };
    }
    return this.asaas.handleWebhook(body, token);
  }
}

function createAsaasAdapter() {
  const enabled =
    String(process.env.ASAAS_ENABLED || "").toLowerCase() === "1" &&
    !!process.env.ASAAS_API_KEY;
  const env = process.env.ASAAS_ENVIRONMENT || "sandbox";
  const base =
    env === "production"
      ? "https://api.asaas.com/v3"
      : "https://sandbox.asaas.com/api/v3";
  const apiKey = process.env.ASAAS_API_KEY || "";
  const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN || "";

  return {
    enabled,
    env,
    async createDeposit({ userId, amountCents, idempotencyKey }) {
      // Stub: não chama API externa sem chave; devolve QR placeholder para painel futuro.
      if (!apiKey) {
        const err = new Error("ASAAS_API_KEY ausente.");
        err.status = 503;
        throw err;
      }
      return {
        provider: "asaas",
        status: "PENDING_CHECKOUT",
        userId,
        amountCents,
        idempotencyKey: idempotencyKey || null,
        mock: false,
        sandbox: env !== "production",
        pixPayload: {
          note: "Checkout Asaas preparado — configure ASAAS_* e ative no painel.",
          checkoutUrl: null,
          externalRef: `dep_${userId}_${amountCents}`,
        },
        // Em lab com chave sandbox, operador completa no dashboard Asaas.
        apiBase: base,
      };
    },
    async createWithdraw({ userId, amountCents, pixKey }) {
      return {
        provider: "asaas",
        status: "PENDING_TRANSFER",
        userId,
        amountCents,
        pixKey,
        mock: false,
        sandbox: env !== "production",
        note: "Transfer Asaas stub — ativar só após KYC + painel.",
      };
    },
    async handleWebhook(body, token) {
      if (webhookToken && token !== webhookToken) {
        const err = new Error("Webhook token inválido.");
        err.status = 401;
        throw err;
      }
      return {
        ok: true,
        event: body?.event || body?.type || "unknown",
        processed: false,
        note: "Hook recebido; credit ledger quando ASAAS_AUTO_SETTLE=1.",
        bodyPreview: typeof body === "object" ? Object.keys(body || {}) : [],
      };
    },
  };
}

export function createPaymentProvider({
  simulation =
    process.env.NODE_ENV === "development" &&
    process.env.ENABLE_SIMULATED_FUNDS === "1",
} = {}) {
  const asaas = createAsaasAdapter();
  const name = asaas.enabled
    ? "asaas-ready"
    : simulation
      ? "mock-sim"
      : "pix-off";
  return new PaymentProvider({ simulation, name, asaas });
}
