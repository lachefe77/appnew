import Link from "next/link"
import { notFound } from "next/navigation"
import {
  banUserAction,
  freezePlanAction,
  grantPlanAction,
  removePlanAction,
  saveUserAction,
  unbanUserAction,
  unfreezePlanAction,
} from "@/app/actions/admin"
import { AdminHeading } from "@/components/admin-ui"
import { Flash } from "@/components/flash"
import { prisma } from "@/lib/db"
import { formatDate } from "@/lib/format"
import { grantStatusLabel, panelReasonLabel } from "@/server/labels"
import { loadPanelGate } from "@/server/panel-access"

export const dynamic = "force-dynamic"

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ erro?: string; ok?: string }>
}) {
  const { id } = await params
  const query = await searchParams
  const user = await prisma.user.findUnique({
    where: { id },
    include: { plans: { include: { plan: true }, orderBy: { createdAt: "desc" } } },
  })
  if (!user) notFound()
  const plans = await prisma.plan.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } })
  const gate = await loadPanelGate(user.id)
  const situation = user.role === "admin" ? "Administração" : gate.open ? "Painel aberto" : panelReasonLabel[gate.reason]

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/usuarios" className="link-admin">
          Usuários
        </Link>
      </p>
      <AdminHeading title={user.name} lede={`${user.email} · ${situation}`} />
      <Flash erro={query.erro} ok={query.ok} tone="light" />

      <form action={saveUserAction} className="panel grid gap-4 md:grid-cols-2">
        <input type="hidden" name="userId" value={user.id} />
        <label>
          <span className="label-light">Nome</span>
          <input className="field-light" name="name" defaultValue={user.name} required />
        </label>
        <label>
          <span className="label-light">E-mail</span>
          <input className="field-light" name="email" type="email" defaultValue={user.email} required />
        </label>
        {user.referredByCode ? (
          <p className="text-sm text-black/70 md:col-span-2">Indicação: {user.referredByCode}</p>
        ) : null}
        <div>
          <button className="btn-admin" type="submit">
            Salvar dados
          </button>
        </div>
      </form>

      <section className="panel mt-4">
        <h2 className="font-display text-2xl uppercase">Acesso</h2>
        {user.bannedAt ? (
          <>
            <p className="mt-2 text-sm text-black/70">
              Suspensa em {formatDate(user.bannedAt)}
              {user.banReason ? ` · ${user.banReason}` : ""}
            </p>
            <form action={unbanUserAction} className="mt-3">
              <input type="hidden" name="userId" value={user.id} />
              <button className="btn-admin" type="submit">
                Reativar conta
              </button>
            </form>
          </>
        ) : user.role === "admin" ? (
          <p className="mt-2 text-sm text-black/70">Contas de administração não são suspensas por aqui.</p>
        ) : (
          <form action={banUserAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="userId" value={user.id} />
            <label className="min-w-[16rem] flex-1">
              <span className="label-light">Motivo da suspensão</span>
              <input className="field-light" name="reason" required minLength={3} />
            </label>
            <button className="btn-admin-danger" type="submit">
              Suspender
            </button>
          </form>
        )}
      </section>

      <section className="panel mt-4">
        <h2 className="font-display text-2xl uppercase">Conceder plano</h2>
        <p className="mt-1 text-sm text-black/60">
          A concessão substitui um plano ativo ou congelado. Marcar um pedido como pago não faz isso.
        </p>
        {plans.length ? (
          <form action={grantPlanAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="userId" value={user.id} />
            <label>
              <span className="label-light">Plano</span>
              <select className="field-light" name="planId" required>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} · {plan.durationDays} dias
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label-light">Dias</span>
              <input className="field-light w-32" name="days" inputMode="numeric" placeholder="Do plano" />
            </label>
            <button className="btn-admin" type="submit">
              Conceder
            </button>
          </form>
        ) : (
          <p className="mt-3 text-sm text-black/60">Nenhum plano ativo para conceder.</p>
        )}
      </section>

      <section className="mt-4">
        <h2 className="mb-3 font-display text-2xl uppercase">Histórico de planos</h2>
        {user.plans.length ? (
          <div className="sheet">
            <table>
              <thead>
                <tr>
                  <th>Plano</th>
                  <th>Status</th>
                  <th>Início</th>
                  <th>Fim</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {user.plans.map((grant) => (
                  <tr key={grant.id}>
                    <td>{grant.plan.name}</td>
                    <td>{grantStatusLabel[grant.status]}</td>
                    <td className="whitespace-nowrap">{formatDate(grant.startsAt)}</td>
                    <td className="whitespace-nowrap">{formatDate(grant.endsAt)}</td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        {grant.status === "ativo" ? (
                          <form action={freezePlanAction}>
                            <input type="hidden" name="userId" value={user.id} />
                            <input type="hidden" name="grantId" value={grant.id} />
                            <button className="btn-admin-ghost" type="submit">
                              Congelar
                            </button>
                          </form>
                        ) : null}
                        {grant.status === "congelado" ? (
                          <form action={unfreezePlanAction}>
                            <input type="hidden" name="userId" value={user.id} />
                            <input type="hidden" name="grantId" value={grant.id} />
                            <button className="btn-admin-ghost" type="submit">
                              Descongelar
                            </button>
                          </form>
                        ) : null}
                        {grant.status === "ativo" || grant.status === "congelado" ? (
                          <form action={removePlanAction}>
                            <input type="hidden" name="userId" value={user.id} />
                            <input type="hidden" name="grantId" value={grant.id} />
                            <button className="btn-admin-danger" type="submit">
                              Remover
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-black/60">Nenhum plano concedido.</p>
        )}
      </section>
    </>
  )
}
