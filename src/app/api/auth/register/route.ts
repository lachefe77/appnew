import { NextResponse } from "next/server";
import { SESSION_COOKIE, signSession } from "@/lib/session";
import { registerAccount } from "@/server/accounts";
import { jsonError } from "@/server/api";
import { registerSchema } from "@/server/validators";

export async function POST(request: Request) {
  try {
    const input = registerSchema.parse(await request.json());
    const cookie = request.headers.get("cookie") ?? "";
    const affiliate = cookie.match(/(?:^|; )ma_ref=([^;]+)/)?.[1];
    const user = await registerAccount(input, affiliate ? decodeURIComponent(affiliate) : null);
    const token = await signSession({ id: user.id, role: user.role, email: user.email });
    const next = user.role === "RESELLER" ? "/painel" : "/";
    const response = NextResponse.json({ ok: true, next });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
