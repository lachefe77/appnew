import Link from "next/link"
import { PlanGrid } from "@/components/plan-grid"
import { prisma } from "@/lib/db"
import { getSettings } from "@/server/settings"

export const dynamic = "force-dynamic"

const houses = [
  { name: "Pinnacle.com", note: "Fonte real, pública." },
  { name: "Cloudbet", note: "Fonte real, pública, sem chave." },
  { name: "Ps3838", note: "Entra quando a API oficial recebe usuário e senha." },
  { name: "Bcgame", note: "Fonte pública bloqueada neste acesso. Odd de teste." },
  { name: "Betonline", note: "Bloqueada (HTTP 403). Odd de teste." },
  { name: "Bet365Arg", note: "Site sem conexão daqui. Odd de teste." },
  { name: "Bet365Pe", note: "Bloqueada (HTTP 403). Odd de teste." },
  { name: "Fortunejack", note: "Bloqueada (HTTP 502). Odd de teste." },
  { name: "Sbobet", note: "Página pública sem feed de odds. Odd de teste." },
  { name: "Stake.com", note: "Bloqueada (HTTP 403). Odd de teste." },
  { name: "WinamaxES", note: "Página pública sem feed de odds. Odd de teste." },
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
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1.15fr_0.85fr] md:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal">{settings.get("brand.name")}</p>
            <h1 className="mt-3 max-w-xl font-display text-5xl uppercase leading-none md:text-6xl">
              Surebet explicada, com plano e painel
            </h1>
            <p className="mt-4 max-w-xl text-base text-mist">
              Surebet é quando duas casas pagam preços do mesmo jogo que, somados, fecham conta positiva. Você cobre os dois
              lados. Um lado ganha, o outro perde, e a diferença fica com você.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/cadastro" className="btn-primary">
                Criar conta
              </Link>
              <Link href="/planos" className="btn-ghost">
                Ver planos
              </Link>
            </div>
          </div>
          <aside className="rounded-2xl border border-line bg-white p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-mist">Lucro típico</p>
            <p className="mt-2 font-display text-5xl text-signal">2% a 3%</p>
            <p className="mt-3 text-sm text-mist">
              O comum vai até cerca de 7%. Acima disso é raro: em geral é preço muito errado, e some em segundos.
            </p>
          </aside>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-12 md:grid-cols-3">
        {[
          ["O que você vê", "Esporte, jogo, duas casas, as duas odds e o lucro em % e em reais."],
          ["Pré-live e ao vivo", "Antes do apito e durante o jogo. A grade atualiza sem recarregar a página."],
          ["Banca e stake", "O stake sai da sua banca. Há valores prontos e uma calculadora para conferir a conta."],
          ["Alerta", "Som quando nasce um sinal acima do piso. O canal (Discord, Telegram ou WhatsApp) se configura no admin."],
          ["Velocidade", "A odd errada corrige rápido. O sinal entra e sai no mesmo ritmo. Por isso o painel é leve."],
          ["Depois do plano", "A grade abre. Sem plano, a conta entra e os sinais ficam fechados. O pagamento ainda não está nesta versão."],
        ].map(([title, body]) => (
          <article key={title} className="rounded-2xl border border-line bg-white p-5">
            <h2 className="font-display text-2xl uppercase">{title}</h2>
            <p className="mt-2 text-sm text-mist">{body}</p>
          </article>
        ))}
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-12">
        <h2 className="font-display text-4xl uppercase">Casas</h2>
        <p className="mt-2 max-w-2xl text-sm text-mist">
          Só Pinnacle.com e Cloudbet estão com odd real nesta versão. As outras aparecem marcadas como teste. Não prometemos
          odd ao vivo de casa bloqueada.
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {houses.map((house) => (
            <li key={house.name} className="rounded-xl border border-line bg-white px-4 py-3 text-sm">
              <span className="font-semibold">{house.name}.</span> <span className="text-mist">{house.note}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-14">
        <h2 className="font-display text-4xl uppercase">{settings.get("plans.title")}</h2>
        <p className="mt-2 max-w-2xl text-sm text-mist">
          {settings.get("plans.lead")} A compra ainda não abre. O plano, quando existir, libera a grade.
        </p>
        <div className="mt-6">
          <PlanGrid plans={plans} note={settings.get("plans.closedNote")} />
        </div>
      </section>

      {notices.length ? (
        <section className="mx-auto max-w-6xl px-4 pb-12">
          <h2 className="font-display text-3xl uppercase">Avisos</h2>
          <div className="mt-4 grid gap-3">
            {notices.map((notice) => (
              <article key={notice.id} className="rounded-2xl border border-line bg-white p-5">
                <h3 className="font-semibold">{notice.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm text-mist">{notice.body}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </>
  )
}
