import { Card } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";

export default async function MessagesPage() {
  await requireUser(["ADMIN"]);
  const messages = await prisma.notificationLog.findMany({ orderBy: { createdAt: "desc" }, take: 40 });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-4xl">Mensagens</h1>
      <p className="max-w-2xl text-sm text-muted">
        Sem a Evolution API, o lembrete de PIX fica registrado aqui em vez de sair no WhatsApp. O texto padrão não inventa prazo de caminhão nem lote separado.
      </p>
      <div className="space-y-3">
        {messages.map((message) => (
          <Card key={message.id}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-[0.14em] text-muted">
              <span>{message.channel} · {message.status}</span>
              <span>{message.target}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm">{message.body}</p>
            {message.error ? <p className="mt-2 text-xs text-muted">{message.error}</p> : null}
          </Card>
        ))}
        {messages.length === 0 ? <p className="text-sm text-muted">Nenhuma mensagem ainda. Dispare os lembretes na operação.</p> : null}
      </div>
    </div>
  );
}
