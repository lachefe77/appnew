import { PostButton } from "@/components/post-button";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";

export default async function ContactsInboxPage() {
  await requireUser(["MASTER", "ADMIN", "SUPPORT", "OPERATOR"]);
  const rows = await prisma.contactMessage.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Contatos</h1>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="rounded-2xl border border-line bg-card p-4 text-sm">
            <p className="font-medium">{row.subject}</p>
            <p className="text-muted">{row.name} · {row.email} · {row.phone ?? ""}</p>
            <p className="mt-2 whitespace-pre-wrap">{row.body}</p>
            {row.readAt ? <p className="mt-2 text-xs text-muted">Lido</p> : <div className="mt-2"><PostButton url="/api/admin/inbox" body={{ kind: "contact", id: row.id }} label="Marcar como lido" /></div>}
          </li>
        ))}
      </ul>
      {rows.length === 0 ? <p className="text-sm text-muted">Nenhuma mensagem.</p> : null}
    </div>
  );
}
