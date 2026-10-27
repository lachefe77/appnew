import { NextResponse } from "next/server";
import { jsonError } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { generatePixDeposit } from "@/server/deposits";
import { depositSchema } from "@/server/validators";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(["RESELLER", "ADMIN", "MASTER"]);
    const input = depositSchema.parse(await request.json());
    const charge = await generatePixDeposit(user.id, input.amountCents);
    return NextResponse.json(charge);
  } catch (error) {
    return jsonError(error);
  }
}
