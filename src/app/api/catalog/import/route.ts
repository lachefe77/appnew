import { NextResponse } from "next/server";
import { jsonError } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { importProduct, removeImport } from "@/server/catalog";
import { z } from "zod";

const schema = z.object({ productId: z.string().min(1) });

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(["RESELLER", "ADMIN", "MASTER"]);
    const input = schema.parse(await request.json());
    await importProduct(user.id, input.productId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireApiUser(["RESELLER", "ADMIN", "MASTER"]);
    const input = schema.parse(await request.json());
    await removeImport(user.id, input.productId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
