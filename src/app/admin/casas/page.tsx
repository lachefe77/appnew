import { updateHouseAction } from "@/app/actions/admin"
import { AdminHeading } from "@/components/admin-ui"
import { Flash } from "@/components/flash"
import { prisma } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function HousesPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; ok?: string }>
}) {
  const query = await searchParams
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
      <div className="grid gap-3">
        {houses.map((house) => (
          <form key={house.id} action={updateHouseAction} className="panel flex flex-wrap items-end gap-3">
            <input type="hidden" name="houseId" value={house.id} />
            <img src={house.logoUrl} alt="" width={40} height={40} className="h-10 w-10 rounded-md" />
            <div className="min-w-[10rem]">
              <p className="font-semibold">{house.name}</p>
              <p className="text-xs text-black/55">
                Fonte: teste
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
