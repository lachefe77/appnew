import Link from "next/link"
import { PlanGrid } from "@/components/plan-grid"
import { prisma } from "@/lib/db"
import { getSettings } from "@/server/settings"

export const dynamic = "force-dynamic"

const houses = [
  { name: "Pinnacle.com", live: true, note: "Fonte real, pública." },
  { name: "Cloudbet", live: true, note: "Fonte real, pública, sem chave." },
  { name: "Giro Certo", live: true, note: "Fonte real, pública, sem chave." },
  { name: "Ps3838", live: false, note: "Entra quando a API oficial recebe usuário e senha." },
  { name: "99play", live: false, note: "Página abre. Feed Altenar HTTP 403. Odd de teste." },
  { name: "Bingo em Casa", live: false, note: "Esporte pede login, HTTP 401. Odd de teste." },
  { name: "Bcgame", live: false, note: "Fonte pública bloqueada. Odd de teste." },
  { name: "Betonline", live: false, note: "Bloqueada, HTTP 403. Odd de teste." },
  { name: "Bet365Arg", live: false, note: "Sem conexão daqui. Odd de teste." },
  { name: "Bet365Pe", live: false, note: "Bloqueada, HTTP 403. Odd de teste." },
  { name: "Fortunejack", live: false, note: "Bloqueada, HTTP 502. Odd de teste." },
  { name: "Sbobet", live: false, note: "Página sem feed de odds. Odd de teste." },
  { name: "Stake.com", live: false, note: "Bloqueada, HTTP 403. Odd de teste." },
  { name: "WinamaxES", live: false, note: "Página sem feed de odds. Odd de teste." },
]

export default async function HomePage() {
  const settings = await getSettings()
  const plans = await prisma.plan.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } })
  const notices = settings.flag("site.noticesVisible")
    ? await prisma.notice.findMany({
        where: { published: true, audience: { in: ["todos", "clientes"] } },
        orderBy: { publishedAt: "desc" },
        take: 3,
      })
    : []

  return (
    <div className="poster">
      <section className="mx-auto max-w-6xl px-4 pb-8 pt-10 md:pt-16">
        <p className="poster-figure">2,50%</p>
        <h1 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
          duas odds de 2,05.
        </h1>
        <div className="mt-8 grid max-w-4xl grid-cols-2 gap-4 border-t border-black py-4 text-sm md:grid-cols-4">
          <p>
            <span className="text-black/55">Casa </span>2,05
          </p>
          <p>
            <span className="text-black/55">Fora </span>2,05
          </p>
          <p>
            <span className="text-black/55">Stake </span>R$ 100
          </p>
          <p>
            <span className="text-black/55">Lucro </span>R$ 2,50
          </p>
        </div>
        <p className="mt-6 max-w-xl text-base leading-7 text-mist">
          Surebet é essa conta. Você cobre os dois lados. Um ganha, o outro perde, e a diferença fica com você. O típico é
          2% a 3%. O comum vai até cerca de 7%. Acima disso é raro e some em segundos. O plano abre a grade. A compra ainda
          não abre.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/cadastro" className="btn-primary">
            Criar conta
          </Link>
          <Link href="/planos" className="btn-ghost">
            Ver planos
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-12">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-2xl font-semibold tracking-tight">Casas</h2>
          <Link href="/casas" className="text-sm text-signal">
            Status
          </Link>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-mist">
          Odd real só onde a fonte respondeu. Casa bloqueada entra marcada como teste. Não prometemos odd ao vivo dela.
        </p>
        <div className="mt-4 overflow-x-auto border border-line">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-felt text-[11px] uppercase tracking-[0.14em] text-mist">
              <tr>
                <th className="px-3 py-2 font-semibold">Casa</th>
                <th className="px-3 py-2 font-semibold">Fonte</th>
                <th className="px-3 py-2 font-semibold">Situação</th>
              </tr>
            </thead>
            <tbody>
              {houses.map((house) => (
                <tr key={house.name} className="border-t border-line">
                  <td className="px-3 py-2 font-semibold">{house.name}</td>
                  <td className="px-3 py-2 text-signal">{house.live ? "Real" : "Teste"}</td>
                  <td className="px-3 py-2 text-mist">{house.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-14">
        <h2 className="text-2xl font-semibold tracking-tight">{settings.get("plans.title")}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-mist">
          {settings.get("plans.lead")} A compra ainda não abre. O plano, quando existir, libera a grade.
        </p>
        <div className="mt-6">
          <PlanGrid plans={plans} note={settings.get("plans.closedNote")} />
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-3 px-4 pb-14 md:grid-cols-3">
        {[
          ["Quanto tempo a odd dura?", "Uma odd errada some em segundos. A grade tira a odd real que passou do tempo configurado."],
          ["O que é pré-live?", "É o mercado antes do apito. Ao vivo é o mercado com o jogo rolando. Os dois ficam na mesma grade."],
          ["O que acontece sem plano?", "A conta entra, a banca e a calculadora funcionam, e a grade de sinais fica fechada."],
        ].map(([title, body]) => (
          <article key={title} className="border border-line bg-card p-4">
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-mist">{body}</p>
          </article>
        ))}
      </section>

      {notices.length ? (
        <section className="mx-auto max-w-6xl px-4 pb-12">
          <h2 className="text-2xl font-semibold tracking-tight">Avisos</h2>
          <div className="mt-4 grid gap-3">
            {notices.map((notice) => (
              <article key={notice.id} className="border border-line bg-card p-4">
                <h3 className="font-semibold">{notice.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-mist">{notice.body}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
