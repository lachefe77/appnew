import { LedgerType, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";

type Tx = Prisma.TransactionClient;

export type WalletEntry = {
  userId: string;
  amountCents: bigint;
  type: LedgerType;
  idempotencyKey: string;
  orderId?: string;
  description?: string;
};

export type WalletEntryResult = {
  alreadyProcessed: boolean;
  balanceCents: bigint;
  ledgerId: string;
};

/**
 * Trava a carteira com SELECT ... FOR UPDATE e grava o razão no mesmo commit.
 * amountCents é assinado: positivo credita, negativo debita.
 */
export async function applyWalletEntry(tx: Tx, entry: WalletEntry): Promise<WalletEntryResult> {
  if (entry.amountCents === 0n) throw new AppError("Valor zerado", "ZERO_AMOUNT");

  const rows = await tx.$queryRaw<Array<{ id: string; balanceCents: string; version: number }>>`
    SELECT id, "balanceCents"::text AS "balanceCents", version
    FROM "Wallet"
    WHERE "userId" = ${entry.userId}
    FOR UPDATE
  `;
  const wallet = rows[0];
  if (!wallet) throw new AppError("Carteira não encontrada", "NO_WALLET", 404);

  const existing = await tx.walletLedger.findUnique({
    where: { idempotencyKey: entry.idempotencyKey },
  });
  if (existing) {
    return { alreadyProcessed: true, balanceCents: BigInt(wallet.balanceCents), ledgerId: existing.id };
  }

  const next = BigInt(wallet.balanceCents) + entry.amountCents;
  if (next < 0n) throw new AppError("Saldo insuficiente na carteira", "INSUFFICIENT_FUNDS", 402);

  await tx.wallet.update({
    where: { id: wallet.id },
    data: { balanceCents: next, version: { increment: 1 } },
  });
  const ledger = await tx.walletLedger.create({
    data: {
      walletId: wallet.id,
      orderId: entry.orderId,
      amountCents: entry.amountCents,
      type: entry.type,
      idempotencyKey: entry.idempotencyKey,
      description: entry.description,
    },
  });
  return { alreadyProcessed: false, balanceCents: next, ledgerId: ledger.id };
}

export async function debitForOrder(input: {
  userId: string;
  orderId: string;
  amountCents: number;
  idempotencyKey: string;
  description: string;
}) {
  return prisma.$transaction(async (tx) =>
    applyWalletEntry(tx, {
      userId: input.userId,
      orderId: input.orderId,
      amountCents: BigInt(-input.amountCents),
      type: LedgerType.ORDER_DEBIT,
      idempotencyKey: input.idempotencyKey,
      description: input.description,
    }),
  );
}
