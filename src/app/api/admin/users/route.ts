import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "@/server/api";
import { hashPassword, requireApiUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

const roleSchema = z.enum(["MASTER", "ADMIN", "SUPPORT", "RESELLER", "CUSTOMER"]);

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend"), userId: z.string().min(1) }),
  z.object({ action: z.literal("activate"), userId: z.string().min(1) }),
  z.object({ action: z.literal("role"), userId: z.string().min(1), role: roleSchema }),
  z.object({ action: z.literal("note"), userId: z.string().min(1), note: z.string().trim().max(500) }),
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(3),
    email: z.string().trim().email(),
    password: z.string().min(8),
    role: z.enum(["ADMIN", "SUPPORT", "RESELLER"]),
  }),
]);

export async function POST(request: Request) {
  try {
    const actor = await requireApiUser(["MASTER", "ADMIN"]);
    const input = schema.parse(await readJson(request));
    if (input.action === "create") {
      if (input.role === "ADMIN" && actor.role !== "MASTER") throw new AppError("Só o mestre cria administrador", "FORBIDDEN", 403);
      const user = await prisma.user.create({
        data: {
          name: input.name,
          email: input.email.toLowerCase(),
          passwordHash: await hashPassword(input.password),
          role: input.role,
          planStatus: "ACTIVE",
          wallet: { create: { balanceCents: 0 } },
        },
      });
      return NextResponse.json({ ok: true, id: user.id });
    }
    const target = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!target) throw new AppError("Usuário não encontrado", "NOT_FOUND", 404);
    if (target.role === "MASTER" && actor.role !== "MASTER") throw new AppError("O administrador não altera o mestre", "FORBIDDEN", 403);
    if (target.id === actor.id && (input.action === "suspend" || input.action === "role")) {
      throw new AppError("Você não altera o próprio cargo nem se suspende", "FORBIDDEN", 403);
    }
    if (input.action === "role") {
      if (input.role === "MASTER" && actor.role !== "MASTER") throw new AppError("Só o mestre entrega o cargo de mestre", "FORBIDDEN", 403);
      if (input.role === "ADMIN" && actor.role !== "MASTER") throw new AppError("Só o mestre cria administrador", "FORBIDDEN", 403);
      if (target.role === "MASTER" && input.role !== "MASTER") {
        const masters = await prisma.user.count({ where: { role: "MASTER" } });
        if (masters <= 1) throw new AppError("A casa precisa de um mestre", "LAST_MASTER", 409);
      }
      await prisma.user.update({ where: { id: target.id }, data: { role: input.role } });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "note") {
      await prisma.user.update({ where: { id: target.id }, data: { note: input.note } });
      return NextResponse.json({ ok: true });
    }
    await prisma.user.update({
      where: { id: target.id },
      data: { planStatus: input.action === "suspend" ? "SUSPENDED" : "ACTIVE" },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
