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
    <>
      <section className="pitch-hero border-b border-line">
        <div className="relative z-[1] mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 md:grid-cols-[1.05fr_0.95fr] md:py-20">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-signal">Casa de sinais</p>
            <h1 className="mt-4 max-w-xl font-display text-5xl leading-[0.95] text-ink md:text-6xl">
              Duas casas. Um jogo. Conta positiva.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-mist">
              Surebet é quando os preços do mesmo jogo, somados, fecham no positivo. Você cobre os dois lados. Um ganha, o
              outro perde, e a diferença fica com você. O plano abre a grade.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/cadastro" className="btn-primary">
                Criar conta
              </Link>
              <Link href="/planos" className="btn-ghost">
                Ver planos
              </Link>
            </div>
          </div>
          <aside className="ticket" aria-label="Exemplo de surebet">
            <div className="ticket-head">
              <span>Pré-live · Futebol</span>
              <span className="stamp">+2,50%</span>
            </div>
            <div className="ticket-body">
              <p className="ticket-match">Flamengo x Palmeiras</p>
              <div className="ticket-odds">
                <div>
                  <small>Casa</small>
                  <strong>2,05</strong>
                  <em>Stake R$ 50</em>
                </div>
                <div>
                  <small>Fora</small>
                  <strong>2,05</strong>
                  <em>Stake R$ 50</em>
                </div>
              </div>
            </div>
            <p className="ticket-foot">
              O comum fica em 2% a 3% e vai até cerca de 7%. Acima disso é raro e some em segundos. A compra do plano ainda não abre.
            </p>
          </aside>
        </div>
      </section>

      <section className="border-b border-line">
        <div className="mx-auto grid max-w-6xl grid-cols-3">
          {[
            ["2% a 3%", "Lucro típico"],
            ["até ~7%", "Faixa comum"],
            ["segundos", "A odd errada some"],
          ].map(([value, label]) => (
            <div key={label} className="border-line px-4 py-5 md:px-6 [&:not(:first-child)]:border-l">
              <p className="font-display text-3xl text-signal md:text-4xl">{value}</p>
              <p className="mt-1 text-xs text-mist">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-px bg-line px-4 py-12 md:grid-cols-3">
        {[
          ["01", "A grade", "Esporte, jogo, duas casas, as duas odds e o lucro em % e em reais. Pré-live e ao vivo."],
          ["02", "A banca", "O stake sai do saldo. Há valores prontos, planilha e uma calculadora para conferir a conta."],
          ["03", "O plano", "Sem plano a grade fica fechada. Com plano ela abre. O pagamento fica para a próxima etapa."],
        ].map(([index, title, body]) => (
          <article key={title} className="bg-pitch p-5">
            <p className="text-[11px] font-semibold tracking-[0.16em] text-signal">{index}</p>
            <h2 className="mt-2 text-lg font-semibold tracking-tight">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-mist">{body}</p>
          </article>
        ))}
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
    </>
  )
}
