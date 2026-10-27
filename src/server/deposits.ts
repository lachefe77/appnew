import { getCommerce } from "./commerce";
import { newId } from "./crypto";
import { prisma } from "./db";
import { AppError } from "./errors";
import { formatBRL } from "@/lib/format";
import { issuePix } from "./payments";
import { wake } from "./queue";

export async function generatePixDeposit(userId: string, amountCents: number) {
  const commerce = await getCommerce();
  if (!Number.isInteger(amountCents) || amountCents < commerce.minDepositCents) {
    throw new AppError(`A recarga mínima é ${formatBRL(commerce.minDepositCents)}`, "MIN_DEPOSIT");
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { wallet: true } });
  if (!user?.wallet) throw new AppError("Carteira não encontrada", "NO_WALLET", 404);
  if (user.role === "CUSTOMER") throw new AppError("Recarga disponível para revendedores", "FORBIDDEN", 403);

  const pix = await issuePix({
    amountCents,
    description: `Recarga de carteira — ${user.name}`,
    externalReference: newId("dep"),
    customer: {
      name: user.name,
      cpfCnpj: user.cpfCnpj,
      email: user.email,
      phone: user.phone,
    },
  });

  const charge = await prisma.pixCharge.create({
    data: {
      purpose: "WALLET_DEPOSIT",
      walletId: user.wallet.id,
      provider: pix.provider,
      externalId: pix.externalId,
      amountCents: BigInt(amountCents),
      pixCopyPaste: pix.pixCopyPaste,
      expiresAt: pix.expiresAt,
    },
  });
  const outbox = await prisma.outboxJob.create({
    data: {
      queue: "abandoned-pix-queue",
      jobKey: `recover:${charge.id}`,
      payloadJson: { chargeId: charge.id },
      runAt: new Date(Date.now() + commerce.abandonedPixDelayMs),
    },
  });
  await wake("abandoned-pix-queue", outbox.id, commerce.abandonedPixDelayMs);
  return {
    externalId: charge.externalId,
    amountCents,
    pixCopyPaste: pix.pixCopyPaste,
    qrCodeBase64: pix.qrCodeBase64,
    expiresAt: pix.expiresAt.toISOString(),
    status: charge.status,
  };
}
