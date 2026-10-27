import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { jsonError } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

export async function POST(request: Request) {
  try {
    await requireApiUser(["MASTER", "ADMIN"]);
    const form = await request.formData();
    const id = String(form.get("id") ?? "");
    const file = form.get("file");
    if (!id || !(file instanceof File)) throw new AppError("Envie a foto do produto", "NO_FILE", 400);
    if (file.size > 4_000_000) throw new AppError("A foto passa de 4 MB", "FILE_TOO_LARGE", 400);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      throw new AppError("Use JPG, PNG ou WebP", "BAD_TYPE", 400);
    }
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) throw new AppError("Produto não encontrado", "NOT_FOUND", 404);
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const filename = `${product.slug}-${Date.now()}.${ext}`;
    const directory = path.join(process.cwd(), "public", "uploads");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, filename), Buffer.from(await file.arrayBuffer()));
    await prisma.product.update({
      where: { id },
      data: { images: { push: `/uploads/${filename}` }, curated: true },
    });
    return NextResponse.json({ ok: true, url: `/uploads/${filename}` });
  } catch (error) {
    return jsonError(error);
  }
}
