import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "@/server/api";
import { prisma } from "@/server/db";

const schema = z.object({ code: z.string().trim().min(2).max(20) });

export async function POST(request: Request) {
  try {
    const input = schema.parse(await readJson(request));
    const owner = await prisma.user.findFirst({
      where: { affiliateCode: input.code.toUpperCase(), role: "RESELLER", planStatus: "ACTIVE" },
    });
    const response = NextResponse.json({ ok: Boolean(owner) });
    if (owner) {
      response.cookies.set("ma_ref", owner.affiliateCode ?? input.code.toUpperCase(), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
