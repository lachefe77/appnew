import { redirect } from "next/navigation"
import { AdminHeading } from "@/components/admin-ui"
import { prisma } from "@/lib/db"
import { requireAdmin } from "@/lib/session"
import { normalizeName } from "@/server/match"

export const dynamic = "force-dynamic"

export default async function AliasPage() {
  await requireAdmin()
  const aliases = await prisma.nameAlias.findMany({ orderBy: { createdAt: "desc" }, take: 100 })
  return (
    <>
      <AdminHeading title="Apelidos" lede="Quando o nome do time ou do campeonato muda de casa para casa, grave o apelido. A grade usa o nome canônico." />
      <form action={saveAlias} className="panel mb-4 flex flex-wrap items-end gap-2">
        <label>
          <span className="label-light">Tipo</span>
          <select className="field-light" name="kind" defaultValue="time">
            <option value="time">Time</option>
            <option value="campeonato">Campeonato</option>
          </select>
        </label>
        <label>
          <span className="label-light">Como vem na fonte</span>
          <input className="field-light" name="source" required />
        </label>
        <label>
          <span className="label-light">Nome canônico</span>
          <input className="field-light" name="target" required />
        </label>
        <button className="btn-admin" type="submit">
          Salvar
        </button>
      </form>
      <div className="sheet">
        <table>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Fonte</th>
              <th>Canônico</th>
            </tr>
          </thead>
          <tbody>
            {aliases.map((alias) => (
              <tr key={alias.id}>
                <td>{alias.kind}</td>
                <td>{alias.source}</td>
                <td>{alias.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

async function saveAlias(formData: FormData) {
  "use server"
  await requireAdmin()
  const kind = String(formData.get("kind") ?? "") === "campeonato" ? "campeonato" : "time"
  const source = normalizeName(String(formData.get("source") ?? ""))
  const target = normalizeName(String(formData.get("target") ?? ""))
  if (!source || !target) redirect("/admin/apelidos")
  await prisma.nameAlias.upsert({
    where: { kind_source: { kind, source } },
    update: { target },
    create: { kind, source, target },
  })
  redirect("/admin/apelidos")
}
