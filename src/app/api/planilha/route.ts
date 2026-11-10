import { prisma } from "@/lib/db"
import { getSession } from "@/lib/session"

export async function GET() {
  const session = await getSession()
  if (!session) return new Response("Entre de novo.", { status: 401 })
  const rows = await prisma.stakeLaunch.findMany({
    where: { userId: session.sub },
    orderBy: { createdAt: "desc" },
    take: 500,
  })
  const header = "quando,sinal,stake_centavos,lucro_centavos,resultado,sobra_centavos"
  const lines = rows.map((row) =>
    [row.createdAt.toISOString(), csv(row.note), row.amountCents, row.profitCents, row.result, row.leftoverCents].join(","),
  )
  return new Response([header, ...lines].join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=planilha.csv",
    },
  })
}

function csv(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}
