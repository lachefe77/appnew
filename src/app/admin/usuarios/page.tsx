import Link from "next/link"
import { AdminHeading } from "@/components/admin-ui"
import { prisma } from "@/lib/db"
import { formatDate } from "@/lib/format"
import { Pager } from "@/components/pager"
import { panelReasonLabel } from "@/server/labels"
import { pageWindow } from "@/server/paging"
import { decidePanelAccess, expireElapsedGrants } from "@/server/panel-access"

export const dynamic = "force-dynamic"

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const query = await searchParams
  const q = (query.q ?? "").trim()
  const window = pageWindow(query.page)
  await expireElapsedGrants()
  const now = new Date()
  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" as const } },
          { name: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : undefined
  const total = await prisma.user.count({ where })
  const users = await prisma.user.findMany({
    where,
    include: { plans: true },
    orderBy: { createdAt: "desc" },
    skip: window.skip,
    take: window.take,
  })

  return (
    <>
      <AdminHeading title="Usuários" lede="Edite a conta, suspenda o acesso e conceda, congele ou remova o plano." />
      <form action="/admin/usuarios" className="mb-4 flex flex-wrap gap-2">
        <input className="field-light max-w-sm" name="q" defaultValue={q} placeholder="Nome ou e-mail" />
        <button className="btn-admin" type="submit">
          Buscar
        </button>
      </form>
      <div className="sheet">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Papel</th>
              <th>Situação</th>
              <th>Desde</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const gate = decidePanelAccess({
                banned: user.bannedAt != null,
                siteOnline: true,
                signalsVisible: true,
                now,
                grants: user.plans.map((plan) => ({
                  status: plan.status,
                  startsAt: plan.startsAt,
                  endsAt: plan.endsAt,
                })),
              })
              const situation =
                user.role === "admin" ? "Administração" : gate.open ? "Painel aberto" : panelReasonLabel[gate.reason]
              return (
                <tr key={user.id}>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  <td>{user.role === "admin" ? "Admin" : user.role === "moderador" ? "Moderador" : "Cliente"}</td>
                  <td>{situation}</td>
                  <td className="whitespace-nowrap">{formatDate(user.createdAt)}</td>
                  <td>
                    <Link className="link-admin" href={`/admin/usuarios/${user.id}`}>
                      Abrir
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!users.length ? <p className="mt-4 text-sm text-black/60">Nenhum usuário encontrado.</p> : null}
      <Pager page={window.page} pages={Math.max(1, Math.ceil(total / window.take))} href={q ? `/admin/usuarios?q=${encodeURIComponent(q)}` : "/admin/usuarios"} />
    </>
  )
}
