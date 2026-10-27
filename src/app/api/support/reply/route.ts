import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

const schema = z.object({
  ticketId: z.string().min(1),
  body: z.string().trim().min(2).max(4000),
  close: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(["MASTER", "ADMIN", "SUPPORT", "OPERATOR"]);
    const input = schema.parse(await readJson(request));
    const ticket = await prisma.supportTicket.findUnique({ where: { id: input.ticketId } });
    if (!ticket) throw new AppError("Chamado não encontrado", "NOT_FOUND", 404);
    await prisma.supportMessage.create({
      data: { ticketId: ticket.id, authorId: user.id, body: input.body, staff: true },
    });
    await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { status: input.close ? "CLOSED" : "ANSWERED" },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
