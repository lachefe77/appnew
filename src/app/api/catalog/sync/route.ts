import { NextResponse } from "next/server";
import { jsonError } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { syncCatalogs } from "@/server/catalog";

export async function POST() {
  try {
    await requireApiUser(["MASTER", "ADMIN"]);
    const result = await syncCatalogs();
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
