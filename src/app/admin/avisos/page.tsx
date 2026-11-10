import { createNoticeAction, toggleNoticeAction } from "@/app/actions/admin"
import { AdminHeading, EmptyNote } from "@/components/admin-ui"
import { Flash } from "@/components/flash"
import { prisma } from "@/lib/db"
import { formatDate } from "@/lib/format"
import { audienceLabel } from "@/server/labels"

export const dynamic = "force-dynamic"

export default async function NoticesPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; ok?: string }>
}) {
  const query = await searchParams
  const notices = await prisma.notice.findMany({ orderBy: { createdAt: "desc" }, take: 100 })
  return (
    <>
      <AdminHeading title="Avisos" lede="O texto publicado aparece no site quando os avisos estão ligados." />
      <Flash erro={query.erro} ok={query.ok} tone="light" />
      <form action={createNoticeAction} className="panel grid gap-3">
        <label>
          <span className="label-light">Título</span>
          <input className="field-light" name="title" required />
        </label>
        <label>
          <span className="label-light">Texto</span>
          <textarea className="field-light min-h-28" name="body" required />
        </label>
        <label>
          <span className="label-light">Onde aparece</span>
          <select className="field-light" name="audience" defaultValue="todos">
            <option value="todos">Todo o site</option>
            <option value="clientes">Início e planos</option>
            <option value="painel">Painel</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="publish" value="true" defaultChecked />
          Publicar agora
        </label>
        <div>
          <button className="btn-admin" type="submit">
            Salvar aviso
          </button>
        </div>
      </form>
      <div className="mt-4">
        {notices.length ? (
          <div className="sheet">
            <table>
              <thead>
                <tr>
                  <th>Título</th>
                  <th>Público</th>
                  <th>Estado</th>
                  <th>Quando</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {notices.map((notice) => (
                  <tr key={notice.id}>
                    <td>
                      <p className="font-semibold">{notice.title}</p>
                      <p className="mt-1 max-w-md whitespace-pre-wrap text-black/60">{notice.body}</p>
                    </td>
                    <td>{audienceLabel[notice.audience]}</td>
                    <td>{notice.published ? "Publicado" : "Rascunho"}</td>
                    <td className="whitespace-nowrap">{formatDate(notice.publishedAt ?? notice.createdAt)}</td>
                    <td>
                      <form action={toggleNoticeAction}>
                        <input type="hidden" name="noticeId" value={notice.id} />
                        <input type="hidden" name="published" value={notice.published ? "false" : "true"} />
                        <button className="btn-admin-ghost" type="submit">
                          {notice.published ? "Ocultar" : "Publicar"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyNote>Nenhum aviso criado.</EmptyNote>
        )}
      </div>
    </>
  )
}
