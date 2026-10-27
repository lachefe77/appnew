import { ledgerLabel } from "@/lib/format";
import { jsonError } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser(["RESELLER", "ADMIN"]);
    if (!user.wallet) throw new AppError("Carteira não encontrada", "NO_WALLET", 404);
    const type = new URL(request.url).searchParams.get("type");
    const entries = await prisma.walletLedger.findMany({
      where: { walletId: user.wallet.id, ...(type ? { type: type as "PIX_DEPOSIT" } : {}) },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const lines = ["data,tipo,centavos,descricao", ...entries.map((entry) => `${entry.createdAt.toISOString()},${ledgerLabel(entry.type)},${entry.amountCents},"${(entry.description ?? "").replaceAll('"', "'")}"`)];
    return new Response(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=extrato.csv",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
