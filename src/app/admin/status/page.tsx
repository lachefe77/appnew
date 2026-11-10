import { saveSettingsAction, testAlertAction } from "@/app/actions/admin"
import { AdminHeading } from "@/components/admin-ui"
import { Flash } from "@/components/flash"
import { prisma } from "@/lib/db"
import { formatDate } from "@/lib/format"
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
  const [runs, timings] = await Promise.all([
    prisma.feedRun.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
    prisma.pageTiming.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
  ])
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
      <form action={testAlertAction} className="panel mt-4">
        <p className="text-sm">Envia uma mensagem de teste no canal configurado. O estado fica na auditoria.</p>
        <button className="btn-admin mt-3" type="submit">
          Testar alerta
        </button>
      </form>
      <div className="panel mt-4">
        <h2 className="font-semibold">Coleta</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {runs.map((run) => (
            <li key={run.id}>
              {formatDate(run.createdAt)} · {run.houseSlug} · {run.durationMs} ms · {run.ok ? "ok" : "falhou"}
            </li>
          ))}
          {!runs.length ? <li>Nenhuma coleta registrada. O processo worker ainda não rodou.</li> : null}
        </ul>
        <h2 className="mt-4 font-semibold">Abertura de páginas</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {timings.map((timing) => (
            <li key={timing.id}>
              {formatDate(timing.createdAt)} · {timing.route} · {timing.durationMs} ms
            </li>
          ))}
          {!timings.length ? <li>Nenhuma medida ainda.</li> : null}
        </ul>
      </div>
    </>
  )
}
