import { AdminHeading, EmptyNote } from "@/components/admin-ui"
import { Pager } from "@/components/pager"
import { prisma } from "@/lib/db"
import { formatDate } from "@/lib/format"
import { pageWindow } from "@/server/paging"

export const dynamic = "force-dynamic"

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const query = await searchParams
  const window = pageWindow(query.page)
  const total = await prisma.auditLog.count()
  const entries = await prisma.auditLog.findMany({
    include: { actor: true },
    orderBy: { createdAt: "desc" },
    skip: window.skip,
    take: window.take,
  })
  return (
    <>
      <AdminHeading title="Auditoria" lede="Ações da administração, da mais recente para a mais antiga." />
      {entries.length ? (
        <div className="sheet">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>Ação</th>
                <th>Resumo</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap">{formatDate(entry.createdAt)}</td>
                  <td>{entry.actor?.email ?? "—"}</td>
                  <td className="whitespace-nowrap">{entry.action}</td>
                  <td>{entry.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyNote>Nenhuma ação registrada.</EmptyNote>
      )}
      <Pager page={window.page} pages={Math.max(1, Math.ceil(total / window.take))} href="/admin/auditoria" />
    </>
  )
}
