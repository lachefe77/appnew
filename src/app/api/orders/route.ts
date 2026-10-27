import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { createResellerOrder, createStoreOrder } from "@/server/orders";
import { b2bOrderSchema, b2cOrderSchema } from "@/server/validators";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireApiUser();
    const orders = await prisma.order.findMany({
      where: user.role === "ADMIN" || user.role === "OPERATOR" ? {} : { tenantId: user.id },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json({
      orders: orders.map((order) => ({
        publicCode: order.publicCode,
        channel: order.channel,
        customerName: order.customerName,
        totalSaleCents: order.totalSaleCents,
        totalWholesaleCents: order.totalWholesaleCents,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        trackingCode: order.trackingCode,
        createdAt: order.createdAt.toISOString(),
        items: order.items.map((item) => ({ title: item.title, quantity: item.quantity })),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await readJson(request)) as { channel?: string };
    if (body.channel === "B2B") {
      const user = await requireApiUser(["RESELLER", "ADMIN"]);
      const input = b2bOrderSchema.parse(body);
      const orders = await createResellerOrder(user.id, input);
      return NextResponse.json({ publicCode: orders[0]?.publicCode, publicCodes: orders.map((order) => order.publicCode) });
    }
    const input = b2cOrderSchema.parse(body);
    const orders = await createStoreOrder(input);
    return NextResponse.json({ publicCode: orders[0]?.publicCode, publicCodes: orders.map((order) => order.publicCode) });
  } catch (error) {
    return jsonError(error);
  }
}
