import { NextResponse, type NextRequest } from "next/server"
import { SESSION_COOKIE, verifySession } from "@/lib/jwt"

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null

  if (pathname.startsWith("/admin") && (!session || session.role !== "admin")) {
    const url = request.nextUrl.clone()
    url.pathname = "/entrar"
    url.search = ""
    url.searchParams.set("next", pathname)
    return NextResponse.redirect(url)
  }

  if (pathname.startsWith("/painel") && !session) {
    const url = request.nextUrl.clone()
    url.pathname = "/entrar"
    url.search = ""
    url.searchParams.set("next", "/painel")
    return NextResponse.redirect(url)
  }

  const headers = new Headers(request.headers)
  headers.set("x-pathname", pathname)
  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
}
