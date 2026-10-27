import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { prisma } from "@/server/db";

const schema = z.object({
  kind: z.enum(["contact", "job"]),
  id: z.string().min(1),
  status: z.enum(["NEW", "REVIEWING", "ARCHIVED"]).optional(),
});

export async function POST(request: Request) {
  try {
    await requireApiUser(["MASTER", "ADMIN", "SUPPORT", "OPERATOR"]);
    const input = schema.parse(await readJson(request));
    if (input.kind === "contact") {
      await prisma.contactMessage.update({ where: { id: input.id }, data: { readAt: new Date() } });
    } else {
      await prisma.jobApplication.update({ where: { id: input.id }, data: { status: input.status ?? "REVIEWING" } });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
