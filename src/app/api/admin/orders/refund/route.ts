import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { refundOrder } from "@/server/orders";

const schema = z.object({ publicCode: z.string().min(3) });

export async function POST(request: Request) {
  try {
    await requireApiUser(["ADMIN"]);
    const input = schema.parse(await request.json());
    const order = await prisma.order.findUnique({ where: { publicCode: input.publicCode } });
    if (!order) throw new AppError("Pedido não encontrado", "NOT_FOUND", 404);
    await refundOrder(order.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
