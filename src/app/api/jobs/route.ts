import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { jsonError } from "@/server/api";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const phone = String(form.get("phone") ?? "").trim();
    const city = String(form.get("city") ?? "").trim();
    const roleWanted = String(form.get("roleWanted") ?? "").trim();
    const message = String(form.get("message") ?? "").trim();
    if (name.length < 3 || !email.includes("@") || phone.length < 8 || city.length < 2 || roleWanted.length < 2 || message.length < 8) {
      throw new AppError("Preencha nome, e-mail, telefone, cidade, cargo e uma mensagem", "INVALID", 400);
    }
    const file = form.get("resume");
    let resumePath: string | null = null;
    if (file instanceof File && file.size > 0) {
      if (file.size > 5_000_000) throw new AppError("O currículo passa de 5 MB", "FILE_TOO_LARGE", 400);
      if (!/\.(pdf|doc|docx)$/i.test(file.name)) throw new AppError("Envie PDF ou Word", "BAD_FILE", 400);
      const ext = path.extname(file.name).toLowerCase();
      const filename = `${crypto.randomUUID()}${ext}`;
      const dir = path.join(process.cwd(), "data", "resumes");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, filename), Buffer.from(await file.arrayBuffer()));
      resumePath = filename;
    }
    await prisma.jobApplication.create({
      data: { name, email, phone, city, roleWanted, message, resumePath },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
