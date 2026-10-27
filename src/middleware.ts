import { NextResponse, type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  const staff = session.role === "MASTER" || session.role === "ADMIN" || session.role === "SUPPORT" || session.role === "OPERATOR";
  if (pathname.startsWith("/admin") && !staff) {
    return NextResponse.redirect(new URL(session.role === "RESELLER" ? "/painel" : "/", request.url));
  }
  if (pathname.startsWith("/painel") && session.role !== "RESELLER" && session.role !== "ADMIN" && session.role !== "MASTER") {
    return NextResponse.redirect(new URL(staff ? "/admin" : "/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/painel/:path*", "/admin/:path*"],
};
