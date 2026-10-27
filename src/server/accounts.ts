import { prisma } from "./db";
import { AppError } from "./errors";
import { hashPassword, verifyPassword } from "./auth";
import type { z } from "zod";
import type { registerSchema } from "./validators";

export async function registerAccount(input: z.infer<typeof registerSchema>, affiliateCode?: string | null) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new AppError("Este e-mail já tem conta", "EMAIL_TAKEN", 409);
  const role = input.role === "RESELLER" ? "RESELLER" : "CUSTOMER";
  const referrer = affiliateCode
    ? await prisma.user.findFirst({ where: { affiliateCode: affiliateCode.toUpperCase(), role: "RESELLER", planStatus: "ACTIVE" } })
    : null;
  const code = role === "RESELLER" ? await uniqueAffiliateCode(input.name) : null;
  return prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      phone: input.phone,
      cpfCnpj: input.cpfCnpj,
      role,
      planStatus: role === "RESELLER" ? "ACTIVE" : "INACTIVE",
      affiliateCode: code,
      referredById: referrer?.id,
      wallet: { create: { balanceCents: 0 } },
    },
  });
}

async function uniqueAffiliateCode(name: string) {
  const base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z]/g, "").slice(0, 8).toUpperCase() || "LOJA";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = `${base}${10 + Math.floor(Math.random() * 89)}`;
    const taken = await prisma.user.findUnique({ where: { affiliateCode: code } });
    if (!taken) return code;
  }
  return `${base}${Date.now().toString().slice(-4)}`;
}

export async function loginAccount(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new AppError("E-mail ou senha incorretos", "BAD_CREDENTIALS", 401);
  }
  return user;
}
