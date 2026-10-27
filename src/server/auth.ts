import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";
import { readSession, SESSION_COOKIE, signSession, type SessionRole } from "@/lib/session";

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function getSession() {
  const jar = await cookies();
  return readSession(jar.get(SESSION_COOKIE)?.value);
}

export async function setSessionCookie(input: { id: string; role: SessionRole; email: string }) {
  const token = await signSession(input);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function currentUser() {
  const session = await getSession();
  if (!session) return null;
  return prisma.user.findUnique({
    where: { id: session.sub },
    include: { wallet: true },
  });
}

export async function requireUser(roles?: Role[]) {
  const user = await currentUser();
  if (!user) redirect("/entrar");
  if (roles && !roles.includes(user.role)) {
    redirect(user.role === "ADMIN" || user.role === "OPERATOR" ? "/admin" : user.role === "RESELLER" ? "/painel" : "/");
  }
  if (user.planStatus === "SUSPENDED") {
    throw new AppError("Conta suspensa", "SUSPENDED", 403);
  }
  return user;
}

export async function requireApiUser(roles?: Role[]) {
  const user = await currentUser();
  if (!user) throw new AppError("Faça login para continuar", "UNAUTHENTICATED", 401);
  if (roles && !roles.includes(user.role)) throw new AppError("Sem permissão", "FORBIDDEN", 403);
  if (user.planStatus === "SUSPENDED") throw new AppError("Conta suspensa", "SUSPENDED", 403);
  return user;
}
