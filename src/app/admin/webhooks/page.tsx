import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";

export default async function WebhooksPage() {
  await requireUser(["MASTER", "ADMIN", "SUPPORT", "OPERATOR"]);
  const events = await prisma.webhookEvent.findMany({ orderBy: { createdAt: "desc" }, take: 40 });
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Webhooks</h1>
      <p className="text-sm text-muted">Cada linha é um evento do gateway ou do fornecedor. O id externo é o do evento, não o da cobrança.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.14em] text-muted">
            <tr>
              <th className="py-2">Quando</th>
              <th className="py-2">Provedor</th>
              <th className="py-2">Id externo</th>
              <th className="py-2">Processado</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-t border-line">
                <td className="py-2">{event.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                <td className="py-2">{event.provider}</td>
                <td className="py-2">{event.externalId}</td>
                <td className="py-2">{event.processedAt ? "sim" : "não"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {events.length === 0 ? <p className="text-sm text-muted">Nenhum webhook recebido ainda.</p> : null}
    </div>
  );
}
