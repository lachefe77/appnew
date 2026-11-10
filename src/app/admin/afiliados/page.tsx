import {
  createAffiliateAction,
  createCouponAction,
  recordCommissionAction,
  toggleAffiliateAction,
  toggleCouponAction,
} from "@/app/actions/admin"
import { AdminHeading, EmptyNote } from "@/components/admin-ui"
import { Flash } from "@/components/flash"
import { prisma } from "@/lib/db"
import { formatDate, formatMoney } from "@/lib/format"

export const dynamic = "force-dynamic"

export default async function AffiliatesPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; ok?: string }>
}) {
  const query = await searchParams
  const [affiliates, coupons, commissions, orders] = await Promise.all([
    prisma.affiliate.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.coupon.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.affiliateCommission.findMany({
      include: { affiliate: true, order: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.order.findMany({ include: { user: true }, orderBy: { createdAt: "desc" }, take: 50 }),
  ])

  return (
    <>
      <AdminHeading title="Afiliados e cupons" lede="Ficam só aqui até o pagamento existir. A vitrine não pede cupom." />
      <Flash erro={query.erro} ok={query.ok} tone="light" />

      <form action={createAffiliateAction} className="panel grid gap-3 md:grid-cols-3">
        <h2 className="font-display text-2xl uppercase md:col-span-3">Novo afiliado</h2>
        <label>
          <span className="label-light">Nome</span>
          <input className="field-light" name="name" required />
        </label>
        <label>
          <span className="label-light">Código</span>
          <input className="field-light" name="code" required />
        </label>
        <label>
          <span className="label-light">Comissão (%)</span>
          <input className="field-light" name="percent" inputMode="numeric" required placeholder="10" />
        </label>
        <div>
          <button className="btn-admin" type="submit">
            Registrar afiliado
          </button>
        </div>
      </form>

      <div className="mt-4">
        {affiliates.length ? (
          <div className="sheet">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nome</th>
                  <th>Comissão</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {affiliates.map((affiliate) => (
                  <tr key={affiliate.id}>
                    <td>{affiliate.code}</td>
                    <td>{affiliate.name}</td>
                    <td>{affiliate.commissionPercent}%</td>
                    <td>{affiliate.active ? "Ativo" : "Inativo"}</td>
                    <td>
                      <form action={toggleAffiliateAction}>
                        <input type="hidden" name="affiliateId" value={affiliate.id} />
                        <input type="hidden" name="active" value={affiliate.active ? "false" : "true"} />
                        <button className="btn-admin-ghost" type="submit">
                          {affiliate.active ? "Desativar" : "Ativar"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyNote>Nenhum afiliado registrado.</EmptyNote>
        )}
      </div>

      <form action={recordCommissionAction} className="panel mt-6 grid gap-3 md:grid-cols-2">
        <h2 className="font-display text-2xl uppercase md:col-span-2">Registrar comissão</h2>
        <label>
          <span className="label-light">Afiliado</span>
          <select className="field-light" name="affiliateId" required>
            <option value="">Escolha</option>
            {affiliates.map((affiliate) => (
              <option key={affiliate.id} value={affiliate.id}>
                {affiliate.code} · {affiliate.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label-light">Valor (R$)</span>
          <input className="field-light" name="amount" required placeholder="25,00" />
        </label>
        <label>
          <span className="label-light">Pedido</span>
          <select className="field-light" name="orderId" defaultValue="">
            <option value="">Sem pedido</option>
            {orders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.user.email} · {formatMoney(order.amountCents, order.currency)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label-light">Nota</span>
          <input className="field-light" name="note" />
        </label>
        <div>
          <button className="btn-admin" type="submit" disabled={!affiliates.length}>
            Registrar comissão
          </button>
        </div>
      </form>

      <div className="mt-4">
        {commissions.length ? (
          <div className="sheet">
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Afiliado</th>
                  <th>Valor</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {commissions.map((commission) => (
                  <tr key={commission.id}>
                    <td className="whitespace-nowrap">{formatDate(commission.createdAt)}</td>
                    <td>{commission.affiliate.code}</td>
                    <td>{formatMoney(commission.amountCents)}</td>
                    <td>{commission.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <form action={createCouponAction} className="panel mt-6 grid gap-3 md:grid-cols-2">
        <h2 className="font-display text-2xl uppercase md:col-span-2">Novo cupom</h2>
        <label>
          <span className="label-light">Código</span>
          <input className="field-light" name="code" required />
        </label>
        <label>
          <span className="label-light">Tipo</span>
          <select className="field-light" name="type" defaultValue="percentual">
            <option value="percentual">Percentual</option>
            <option value="valor">Valor em reais</option>
          </select>
        </label>
        <label>
          <span className="label-light">Percentual</span>
          <input className="field-light" name="percent" inputMode="numeric" placeholder="10" />
        </label>
        <label>
          <span className="label-light">Valor (R$)</span>
          <input className="field-light" name="amount" placeholder="20,00" />
        </label>
        <label>
          <span className="label-light">Limite de usos</span>
          <input className="field-light" name="maxUses" inputMode="numeric" />
        </label>
        <label>
          <span className="label-light">Validade</span>
          <input className="field-light" name="expiresAt" type="datetime-local" />
        </label>
        <div>
          <button className="btn-admin" type="submit">
            Criar cupom
          </button>
        </div>
      </form>

      <div className="mt-4">
        {coupons.length ? (
          <div className="sheet">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Tipo</th>
                  <th>Valor</th>
                  <th>Usos</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((coupon) => (
                  <tr key={coupon.id}>
                    <td>{coupon.code}</td>
                    <td>{coupon.type === "percentual" ? "Percentual" : "Valor"}</td>
                    <td>{coupon.type === "percentual" ? `${coupon.value}%` : formatMoney(coupon.value)}</td>
                    <td>
                      {coupon.usedCount}
                      {coupon.maxUses != null ? ` / ${coupon.maxUses}` : ""}
                    </td>
                    <td>{coupon.active ? "Ativo" : "Inativo"}</td>
                    <td>
                      <form action={toggleCouponAction}>
                        <input type="hidden" name="couponId" value={coupon.id} />
                        <input type="hidden" name="active" value={coupon.active ? "false" : "true"} />
                        <button className="btn-admin-ghost" type="submit">
                          {coupon.active ? "Desativar" : "Ativar"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyNote>Nenhum cupom criado.</EmptyNote>
        )}
      </div>
    </>
  )
}
