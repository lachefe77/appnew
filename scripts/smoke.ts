import { PrismaClient } from "@prisma/client";
import { sha256, hmacSha256 } from "../src/server/crypto";
import { applyWalletEntry } from "../src/server/wallet";
import { handlePaymentWebhook } from "../src/server/webhooks";
import { config } from "../src/server/config";

const prisma = new PrismaClient();

async function main() {
  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      name: "Smoke",
      email: `smoke-${stamp}@novoshorizontes.test`,
      passwordHash: "not-used",
      role: "RESELLER",
      planStatus: "ACTIVE",
      cpfCnpj: "52998224725",
      wallet: { create: { balanceCents: 0 } },
    },
  });

  const externalId = `sandbox_smoke_${stamp}`;
  const amount = 8_000;
  await prisma.pixCharge.create({
    data: {
      purpose: "WALLET_DEPOSIT",
      walletId: (await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).id,
      provider: "sandbox",
      externalId,
      amountCents: BigInt(amount),
      pixCopyPaste: "SANDBOX",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  const raw = JSON.stringify({
    provider: "sandbox",
    eventId: `evt-${stamp}`,
    externalId,
    amountCents: amount,
  });
  const headers = { signature: hmacSha256(raw, config.webhookSecret), asaasToken: null };
  const first = await handlePaymentWebhook(raw, headers);
  const second = await handlePaymentWebhook(raw, headers);
  const otherEvent = JSON.stringify({
    provider: "sandbox",
    eventId: `evt-${stamp}-b`,
    externalId,
    amountCents: amount,
  });
  const third = await handlePaymentWebhook(otherEvent, {
    signature: hmacSha256(otherEvent, config.webhookSecret),
    asaasToken: null,
  });
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
  assert(first.applied === true, "primeiro webhook credita");
  assert(second.duplicate === true, "mesmo evento não credita de novo");
  assert(third.duplicate === true, "outro evento da mesma cobrança não credita de novo");
  assert(wallet.balanceCents === BigInt(amount), "saldo igual ao PIX");

  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      prisma
        .$transaction((tx) =>
          applyWalletEntry(tx, {
            userId: user.id,
            amountCents: BigInt(-amount),
            type: "ORDER_DEBIT",
            idempotencyKey: sha256(`${user.id}:smoke:${index}`),
            description: "concorrência",
          }),
        )
        .then(() => "ok" as const)
        .catch((error: { code?: string }) => error.code ?? "erro"),
    ),
  );
  const wins = results.filter((item) => item === "ok").length;
  const after = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
  assert(wins === 1, `apenas um débito concorrente vence, veio ${wins}`);
  assert(after.balanceCents === 0n, "saldo zerou sem ficar negativo");

  await prisma.walletLedger.deleteMany({ where: { walletId: wallet.id } });
  await prisma.pixCharge.deleteMany({ where: { walletId: wallet.id } });
  await prisma.webhookEvent.deleteMany({ where: { externalId: { in: [`evt-${stamp}`, `evt-${stamp}-b`] } } });
  await prisma.wallet.delete({ where: { id: wallet.id } });
  await prisma.user.delete({ where: { id: user.id } });
  console.log("Smoke financeiro ok.");
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
