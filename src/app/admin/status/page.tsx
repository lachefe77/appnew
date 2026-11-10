import { saveSettingsAction } from "@/app/actions/admin"
import { AdminHeading } from "@/components/admin-ui"
import { Flash } from "@/components/flash"
import { SETTING_CATALOG } from "@/server/setting-catalog"
import { getSettings } from "@/server/settings"

export const dynamic = "force-dynamic"

export default async function StatusPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; ok?: string }>
}) {
  const query = await searchParams
  const settings = await getSettings()
  const items = SETTING_CATALOG.filter((item) => item.group === "status")
  return (
    <>
      <AdminHeading
        title="Status do site"
        lede="Liga e desliga o que a pessoa vê. A mudança vale no próximo carregamento, sem abrir o servidor."
      />
      <Flash erro={query.erro} ok={query.ok} tone="light" />
      <form action={saveSettingsAction} className="panel space-y-4">
        <input type="hidden" name="group" value="status" />
        {items.map((item) => (
          <label key={item.key} className="flex items-start gap-3">
            <input
              className="mt-1"
              type="checkbox"
              name={item.key}
              value="true"
              defaultChecked={settings.flag(item.key)}
            />
            <span>
              <span className="block font-semibold">{item.label}</span>
              {item.hint ? <span className="block text-sm text-black/60">{item.hint}</span> : null}
            </span>
          </label>
        ))}
        <button className="btn-admin" type="submit">
          Salvar status
        </button>
      </form>
    </>
  )
}
