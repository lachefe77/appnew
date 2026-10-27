import { prisma } from "./db";
import { AppError } from "./errors";
import { hashPassword, verifyPassword } from "./auth";
import type { z } from "zod";
import type { registerSchema } from "./validators";

export async function registerAccount(input: z.infer<typeof registerSchema>) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new AppError("Este e-mail já tem conta", "EMAIL_TAKEN", 409);
  const role = input.role === "RESELLER" ? "RESELLER" : "CUSTOMER";
  return prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      phone: input.phone,
      cpfCnpj: input.cpfCnpj,
      role,
      planStatus: role === "RESELLER" ? "ACTIVE" : "INACTIVE",
      wallet: { create: { balanceCents: 0 } },
    },
  });
}

export async function loginAccount(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new AppError("E-mail ou senha incorretos", "BAD_CREDENTIALS", 401);
  }
  return user;
}
