import { updateHouseAction } from "@/app/actions/admin"
import { AdminHeading } from "@/components/admin-ui"
import { Flash } from "@/components/flash"
import { prisma } from "@/lib/db"
import { formatDate } from "@/lib/format"
import { getSettings } from "@/server/settings"

export const dynamic = "force-dynamic"

export default async function HousesPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; ok?: string }>
}) {
  const query = await searchParams
  const settings = await getSettings()
  const houses = await prisma.house.findMany({
    where: { operable: true },
    orderBy: { sortOrder: "asc" },
    include: { cloneOf: true },
  })
  return (
    <>
      <AdminHeading
        title="Casas"
        lede="As onze casas entram na grade com marca própria e odd de teste. A moeda é a da conta do stake, não o caixa da casa."
      />
      <Flash erro={query.erro} ok={query.ok} tone="light" />
      <div className="panel mb-4 space-y-2 text-sm">
        {houses.map((house) => (
          <p key={house.slug}>
            <strong>{house.name}:</strong> {house.feed === "ao_vivo" ? "fonte real." : "odd de teste."}{" "}
            {house.lastGoodAt ? `Última odd boa em ${formatDate(house.lastGoodAt)}. ` : ""}
            {house.lastError || settings.get(`feed.${house.slug}.detail`)}
          </p>
        ))}
        <p>Ps3838, se ainda estiver em teste: cole o usuário e a senha da API na Configuração. A conta precisa ter saldo.</p>
      </div>
      <div className="grid gap-3">
        {houses.map((house) => (
          <form key={house.id} action={updateHouseAction} className="panel flex flex-wrap items-end gap-3">
            <input type="hidden" name="houseId" value={house.id} />
            <img src={house.logoUrl} alt="" width={40} height={40} className="h-10 w-10 rounded-md" />
            <div className="min-w-[10rem]">
              <p className="font-semibold">{house.name}</p>
              <p className="text-xs text-black/55">
                Fonte: {house.feed === "ao_vivo" ? "real" : "teste"}
                {house.cloneLabel ? ` · clone ${house.cloneLabel}` : ""}
                {house.cloneOf ? ` · de ${house.cloneOf.name}` : ""}
              </p>
            </div>
            <label>
              <span className="label-light">Moeda</span>
              <select className="field-light" name="currency" defaultValue={house.currency}>
                <option value="BRL">BRL</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </label>
            <label>
              <span className="label-light">Lado fixo</span>
              <select className="field-light" name="fixedSide" defaultValue={house.fixedSide}>
                <option value="">Livre</option>
                <option value="casa">Casa</option>
                <option value="fora">Fora</option>
                <option value="over">Over</option>
                <option value="under">Under</option>
              </select>
            </label>
            <label>
              <span className="label-light">Passo (R$)</span>
              <input className="field-light w-24" name="step" defaultValue={(house.stakeStepCents / 100).toFixed(2)} />
            </label>
            <label>
              <span className="label-light">Mínima</span>
              <input className="field-light w-24" name="min" defaultValue={(house.minStakeCents / 100).toFixed(2)} />
            </label>
            <label>
              <span className="label-light">Máxima</span>
              <input className="field-light w-28" name="max" defaultValue={(house.maxStakeCents / 100).toFixed(2)} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" value="true" defaultChecked={house.active} />
              Ativa na grade
            </label>
            <button className="btn-admin" type="submit">
              Salvar
            </button>
          </form>
        ))}
      </div>
    </>
  )
}
