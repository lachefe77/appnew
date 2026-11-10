import { saveSettingsAction } from "@/app/actions/admin"
import { AdminHeading } from "@/components/admin-ui"
import { Flash } from "@/components/flash"
import { SETTING_CATALOG } from "@/server/setting-catalog"
import { getSettings } from "@/server/settings"

export const dynamic = "force-dynamic"

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; ok?: string }>
}) {
  const query = await searchParams
  const settings = await getSettings()
  const texts = SETTING_CATALOG.filter((item) => item.group === "textos")
  const params = SETTING_CATALOG.filter((item) => item.group === "parametros")
  return (
    <>
      <AdminHeading
        title="Configuração"
        lede="Textos e parâmetros que o site lê. O valor salvo aqui substitui o padrão."
      />
      <Flash erro={query.erro} ok={query.ok} tone="light" />
      <form action={saveSettingsAction} className="grid gap-4">
        <input type="hidden" name="group" value="textos" />
        <section className="panel grid gap-3">
          <h2 className="font-display text-2xl uppercase">Textos</h2>
          {texts.map((item) => (
            <label key={item.key}>
              <span className="label-light">{item.label}</span>
              {item.kind === "longtext" ? (
                <textarea className="field-light min-h-20" name={item.key} defaultValue={settings.get(item.key)} required />
              ) : (
                <input className="field-light" name={item.key} defaultValue={settings.get(item.key)} required />
              )}
              {item.hint ? <span className="mt-1 block text-xs text-black/50">{item.hint}</span> : null}
            </label>
          ))}
        </section>
        <button className="btn-admin w-fit" type="submit">
          Salvar textos
        </button>
      </form>
      <form action={saveSettingsAction} className="mt-6 grid gap-4">
        <input type="hidden" name="group" value="parametros" />
        <section className="panel grid gap-3 md:grid-cols-2">
          <h2 className="font-display text-2xl uppercase md:col-span-2">Parâmetros</h2>
          {params.map((item) => (
            <label key={item.key}>
              <span className="label-light">{item.label}</span>
              <input className="field-light" name={item.key} defaultValue={settings.get(item.key)} required />
              {item.hint ? <span className="mt-1 block text-xs text-black/50">{item.hint}</span> : null}
            </label>
          ))}
        </section>
        <button className="btn-admin w-fit" type="submit">
          Salvar parâmetros
        </button>
      </form>
    </>
  )
}
