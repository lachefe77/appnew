import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./errors";

export function jsonError(error: unknown) {
  if (error instanceof AppError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? "Dados inválidos", code: "VALIDATION" }, { status: 400 });
  }
  console.error(error);
  return NextResponse.json({ error: "Erro interno", code: "INTERNAL" }, { status: 500 });
}

export async function readJson(request: Request) {
  const text = await request.text();
  if (!text) return {};
  return JSON.parse(text) as unknown;
}
