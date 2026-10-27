import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "@/server/api";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

const schema = z.object({
  publicCode: z.string().trim().min(4),
  txHash: z.string().trim().regex(/^[A-Za-z0-9]{16,120}$/, "Hash inválido"),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await readJson(request));
    const order = await prisma.order.findUnique({ where: { publicCode: input.publicCode } });
    if (!order || order.payMethod !== "USDT") throw new AppError("Pedido USDT não encontrado", "NOT_FOUND", 404);
    if (order.paymentStatus !== "PENDING") throw new AppError("Este pedido já não está aguardando pagamento", "NOT_PENDING", 409);
    await prisma.order.update({ where: { id: order.id }, data: { cryptoTxHash: input.txHash } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
