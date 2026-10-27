import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { sha256 } from "@/server/crypto";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { adjustSchema } from "@/server/validators";
import { applyWalletEntry } from "@/server/wallet";

export async function POST(request: Request) {
  try {
    const admin = await requireApiUser(["MASTER", "ADMIN"]);
    const input = adjustSchema.parse(await readJson(request));
    const user = await prisma.user.findUnique({ where: { id: input.userId }, include: { wallet: true } });
    if (!user?.wallet) throw new AppError("Revendedor sem carteira", "NO_WALLET", 404);
    await prisma.$transaction(async (tx) => {
      await applyWalletEntry(tx, {
        userId: user.id,
        amountCents: BigInt(input.amountCents),
        type: "ADMIN_ADJUSTMENT",
        idempotencyKey: sha256(`${admin.id}:${user.id}:${input.reason}:${input.amountCents}:${Date.now()}`),
        description: input.reason,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
