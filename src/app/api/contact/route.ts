import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "@/server/api";
import { prisma } from "@/server/db";

const schema = z.object({
  name: z.string().trim().min(3).max(120),
  email: z.string().trim().email(),
  phone: z.string().trim().max(20).optional().default(""),
  subject: z.string().trim().min(3).max(120),
  body: z.string().trim().min(8).max(2000),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await readJson(request));
    await prisma.contactMessage.create({
      data: { name: input.name, email: input.email, phone: input.phone || null, subject: input.subject, body: input.body },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
