import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { pauseFulfillment, resumeFulfillment, sweepDueJobs } from "@/server/jobs";
import { prisma } from "@/server/db";

const schema = z.object({ action: z.enum(["pause", "resume", "sweep"]) });

export async function POST(request: Request) {
  try {
    await requireApiUser(["ADMIN"]);
    const input = schema.parse(await request.json());
    if (input.action === "pause") await pauseFulfillment("Pausa manual do administrador");
    if (input.action === "resume") await resumeFulfillment();
    if (input.action === "sweep") {
      await prisma.outboxJob.updateMany({
        where: { status: "PENDING", queue: "abandoned-pix-queue" },
        data: { runAt: new Date() },
      });
      await sweepDueJobs();
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
