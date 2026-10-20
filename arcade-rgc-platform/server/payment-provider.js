/**
 * PaymentProvider — abstração de depósito/saque.
 * PIX real permanece OFF (409). Mock só em development + ENABLE_SIMULATED_FUNDS.
 */

export class PaymentProvider {
  constructor({ simulation = false, name = "none" } = {}) {
    this.simulation = Boolean(simulation);
    this.name = name;
  }

  /** Depósito PIX: mock credita ledger; produção/real sempre rejeita. */
  async createDeposit({ userId, amountCents, idempotencyKey }) {
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
}

export function createPaymentProvider({
  simulation =
    process.env.NODE_ENV === "development" &&
    process.env.ENABLE_SIMULATED_FUNDS === "1",
} = {}) {
  return new PaymentProvider({
    simulation,
    name: simulation ? "mock-sim" : "pix-off",
  });
}
