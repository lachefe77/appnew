import { NextResponse } from "next/server";
import { SESSION_COOKIE, safeNext, signSession } from "@/lib/session";
import { recordAccess } from "@/server/access";
import { loginAccount } from "@/server/accounts";
import { jsonError } from "@/server/api";
import { homePath } from "@/server/roles";
import { loginSchema } from "@/server/validators";

export async function POST(request: Request) {
  try {
    const input = loginSchema.parse(await request.json());
    const user = await loginAccount(input.email, input.password);
    await recordAccess(user.id, request, "login");
    const token = await signSession({ id: user.id, role: user.role, email: user.email });
    const next =
      safeNext(input.next) ?? homePath(user.role);
    const response = NextResponse.json({ ok: true, next, role: user.role });
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
