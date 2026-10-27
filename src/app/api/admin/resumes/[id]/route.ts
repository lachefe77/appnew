import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { jsonError } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireApiUser(["MASTER", "ADMIN", "SUPPORT", "OPERATOR"]);
    const { id } = await context.params;
    const application = await prisma.jobApplication.findUnique({ where: { id } });
    if (!application?.resumePath) throw new AppError("Currículo não encontrado", "NOT_FOUND", 404);
    const filename = path.basename(application.resumePath);
    const bytes = await readFile(path.join(process.cwd(), "data", "resumes", filename));
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
