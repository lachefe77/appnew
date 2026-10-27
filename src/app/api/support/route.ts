import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "@/server/api";
import { currentUser } from "@/server/auth";
import { prisma } from "@/server/db";

const schema = z.object({
  name: z.string().trim().min(3).max(120),
  email: z.string().trim().email(),
  subject: z.string().trim().min(3).max(140),
  body: z.string().trim().min(8).max(4000),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await readJson(request));
    const user = await currentUser();
    const ticket = await prisma.supportTicket.create({
      data: {
        userId: user?.id,
        name: input.name,
        email: input.email.toLowerCase(),
        subject: input.subject,
        messages: { create: { authorId: user?.id, body: input.body, staff: false } },
      },
    });
    return NextResponse.json({ ok: true, id: ticket.id });
  } catch (error) {
    return jsonError(error);
  }
}
