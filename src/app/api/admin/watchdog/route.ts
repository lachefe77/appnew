import { NextResponse } from "next/server";
import { jsonError } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { runWatchdog } from "@/server/watchdog";

export async function POST() {
  try {
    await requireApiUser(["ADMIN"]);
    await runWatchdog();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
