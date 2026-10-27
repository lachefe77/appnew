import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { sendWhatsAppText } from "@/server/notifications";

const schema = z.object({ id: z.string().min(1) });

export async function POST(request: Request) {
  try {
    await requireApiUser(["MASTER", "ADMIN", "SUPPORT", "OPERATOR"]);
    const input = schema.parse(await readJson(request));
    const message = await prisma.notificationLog.findUnique({ where: { id: input.id } });
    if (!message) throw new AppError("Mensagem não encontrada", "NOT_FOUND", 404);
    if (!message.channel.startsWith("whatsapp")) throw new AppError("Só mensagem de WhatsApp pode ser reenviada", "NOT_WHATSAPP", 400);
    await sendWhatsAppText(message.target, message.body, message.orderId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
