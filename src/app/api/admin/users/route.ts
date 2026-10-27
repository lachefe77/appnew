import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "@/server/api";
import { hashPassword, requireApiUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

const schema = z.object({
  action: z.enum(["suspend", "activate", "operator"]),
  userId: z.string().optional(),
  name: z.string().trim().min(3).optional(),
  email: z.string().trim().email().optional(),
  password: z.string().min(8).optional(),
});

export async function POST(request: Request) {
  try {
    await requireApiUser(["ADMIN"]);
    const input = schema.parse(await readJson(request));
    if (input.action === "operator") {
      if (!input.name || !input.email || !input.password) throw new AppError("Nome, e-mail e senha do operador", "INVALID", 400);
      const user = await prisma.user.create({
        data: {
          name: input.name,
          email: input.email.toLowerCase(),
          passwordHash: await hashPassword(input.password),
          role: "OPERATOR",
          planStatus: "ACTIVE",
        },
      });
      return NextResponse.json({ ok: true, id: user.id });
    }
    if (!input.userId) throw new AppError("Informe o revendedor", "INVALID", 400);
    await prisma.user.update({
      where: { id: input.userId },
      data: { planStatus: input.action === "suspend" ? "SUSPENDED" : "ACTIVE" },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
