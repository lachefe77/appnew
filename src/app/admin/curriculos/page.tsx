import { PostButton } from "@/components/post-button";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";

export default async function ResumesPage() {
  await requireUser(["MASTER", "ADMIN", "SUPPORT", "OPERATOR"]);
  const rows = await prisma.jobApplication.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Currículos</h1>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="rounded-2xl border border-line bg-card p-4 text-sm">
            <p className="font-medium">{row.name} · {row.roleWanted}</p>
            <p className="text-muted">{row.email} · {row.phone} · {row.city} · {row.status}</p>
            <p className="mt-2 whitespace-pre-wrap">{row.message}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {row.resumePath ? <a className="rounded-full border border-line px-3 py-1.5" href={`/api/admin/resumes/${row.id}`}>Baixar currículo</a> : null}
              <PostButton url="/api/admin/inbox" body={{ kind: "job", id: row.id, status: "REVIEWING" }} label="Em análise" />
              <PostButton url="/api/admin/inbox" body={{ kind: "job", id: row.id, status: "ARCHIVED" }} label="Arquivar" />
            </div>
          </li>
        ))}
      </ul>
      {rows.length === 0 ? <p className="text-sm text-muted">Nenhum currículo.</p> : null}
    </div>
  );
}
