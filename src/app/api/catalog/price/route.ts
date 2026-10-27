import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

const schema = z.object({
  productId: z.string().min(1),
  retailPriceCents: z.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(["RESELLER", "ADMIN"]);
    const input = schema.parse(await readJson(request));
    const imported = await prisma.catalogImport.findUnique({
      where: { userId_productId: { userId: user.id, productId: input.productId } },
    });
    if (!imported) throw new AppError("Importe o produto antes de definir o preço", "NOT_IMPORTED", 404);
    await prisma.catalogImport.update({
      where: { id: imported.id },
      data: { retailPriceCents: input.retailPriceCents },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
