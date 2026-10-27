import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { customerSaveSchema } from "@/server/validators";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(["RESELLER", "ADMIN"]);
    const input = customerSaveSchema.parse(await readJson(request));
    const email = input.email?.trim() ? input.email.trim() : null;
    const row = await prisma.resellerCustomer.upsert({
      where: { userId_cpf: { userId: user.id, cpf: input.cpf } },
      create: { userId: user.id, name: input.name, cpf: input.cpf, phone: input.phone, email },
      update: { name: input.name, phone: input.phone, email },
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (error) {
    return jsonError(error);
  }
}
