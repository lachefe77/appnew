import { AdminHeading, EmptyNote } from "@/components/admin-ui"
import { prisma } from "@/lib/db"
import { formatDate } from "@/lib/format"

export const dynamic = "force-dynamic"

export default async function AuditPage() {
  const entries = await prisma.auditLog.findMany({
    include: { actor: true },
    orderBy: { createdAt: "desc" },
    take: 200,
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
    </>
  )
}
