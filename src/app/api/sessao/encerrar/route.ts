import { NextResponse } from "next/server"
import { SESSION_COOKIE } from "@/lib/jwt"
import { BANNED_MESSAGE } from "@/server/accounts"

export async function GET(request: Request) {
  const url = new URL("/entrar", request.url)
  url.searchParams.set("erro", BANNED_MESSAGE)
  const response = NextResponse.redirect(url)
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 })
  return response
}
