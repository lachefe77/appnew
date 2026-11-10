import { prisma } from "@/lib/db"
import { formatDate } from "@/lib/format"

export const dynamic = "force-dynamic"

export default async function HousesStatusPage() {
  const houses = await prisma.house.findMany({ where: { operable: true }, orderBy: { sortOrder: "asc" } })
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Casas</h1>
      <p className="mt-2 text-sm text-mist">
        Só entra como fonte real a casa que respondeu com odd. As outras ficam em teste, com o motivo. Não usamos proxy.
      </p>
      <ul className="mt-6 space-y-3">
        {houses.map((house) => (
          <li key={house.id} className="border border-line bg-card p-4">
            <p className="font-semibold">{house.name}</p>
            <p className="text-sm text-mist">
              {house.feed === "ao_vivo" ? "Fonte real." : "Odd de teste."}{" "}
              {house.lastGoodAt ? `Última odd boa em ${formatDate(house.lastGoodAt)}.` : "Ainda sem odd boa nesta versão."}
            </p>
            {house.lastError ? <p className="mt-1 text-sm text-[#8d2b2b]">{house.lastError}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
