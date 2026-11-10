"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { bankrollAction, launchStakeAction, supportAction } from "@/app/actions/board"
import { centsFromInput } from "@/server/parse"
import type { BoardSignal } from "@/server/surebet"
import { formatMoney } from "@/lib/format"

type HouseChip = {
  id: string
  slug: string
  name: string
  logoUrl: string
  currency: string
  cloneLabel: string
  fixedSide: string
  feed: string
}

type Entry = { id: string; amountCents: number; kind: string; note: string; createdAt: string }

type Props = {
  houses: HouseChip[]
  initialSignals: BoardSignal[]
  balanceCents: number
  currency: string
  initialStakeCents: number
  pollSeconds: number
  quickReais: number[]
  stakePercent: number
  minProfit: number
  entries: Entry[]
  launched: string[]
  autoMarketIds: string[]
}

type Filters = {
  phase: "prelive" | "live"
  houseIds: string[]
  fixedSides: Record<string, string>
  manualOdds: Record<string, number>
  autoOdd: Record<string, boolean>
  autoMarketHouseIds: string[]
  pinnedHouseId: string | null
  minProfit: number
  autoStake: boolean
  manualStakeReais: string
  sort: "alfa" | "clone"
  query: string
  volume: number
}

declare global {
  interface Window {
    __fsAlerts?: number
  }
}

const STORAGE = "fs-board-v1"

function sideLabel(side: string) {
  if (side === "casa") return "Casa"
  if (side === "fora") return "Fora"
  if (side === "over") return "Over"
  if (side === "under") return "Under"
  return side
}

function feedLabel(feed: string) {
  return feed === "ao_vivo" ? "Ao vivo" : "Teste"
}

function percentLabel(value: number) {
  return `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}%`
}

function oddLabel(value: number) {
  return value.toFixed(2).replace(".", ",")
}

export function SignalBoard(props: Props) {
  const [filters, setFilters] = useState<Filters>(() => ({
    phase: "prelive",
    houseIds: props.houses.map((house) => house.id),
    fixedSides: Object.fromEntries(props.houses.filter((house) => house.fixedSide).map((house) => [house.id, house.fixedSide])),
    manualOdds: {},
    autoOdd: Object.fromEntries(props.houses.map((house) => [house.id, true])),
    autoMarketHouseIds: props.autoMarketIds,
    pinnedHouseId: null,
    minProfit: props.minProfit,
    autoStake: true,
    manualStakeReais: String(props.quickReais[0] ?? 100),
    sort: "clone",
    query: "",
    volume: 70,
  }))
  const [signals, setSignals] = useState(props.initialSignals)
  const [balance, setBalance] = useState(props.balanceCents)
  const [stakeCents, setStakeCents] = useState(props.initialStakeCents)
  const [launched, setLaunched] = useState(props.launched)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [alerts, setAlerts] = useState(0)
  const [supportKind, setSupportKind] = useState<"sugestao" | "bug">("sugestao")
  const [supportBody, setSupportBody] = useState("")
  const [amount, setAmount] = useState("100")
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const audioRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE)
    if (!raw) return
    try {
      const saved = JSON.parse(raw) as Partial<Filters>
      setFilters((current) => ({ ...current, ...saved, houseIds: saved.houseIds?.length ? saved.houseIds : current.houseIds }))
    } catch {
      window.localStorage.removeItem(STORAGE)
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(STORAGE, JSON.stringify(filters))
  }, [filters])

  function beep(volume: number) {
    if (volume <= 0) return
    try {
      const Context = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Context) return
      if (!audioRef.current) audioRef.current = new Context()
      const ctx = audioRef.current
      if (ctx.state === "suspended") void ctx.resume()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      gain.gain.value = (volume / 100) * 0.12
      osc.type = "sine"
      osc.frequency.value = 880
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.18)
    } catch {
      return
    }
  }

  async function pull(current: Filters) {
    const manualStake = centsFromInput(current.manualStakeReais)
    const response = await fetch("/api/sinais", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phase: current.phase,
        houseIds: current.houseIds,
        fixedSides: current.fixedSides,
        manualOdds: current.autoOdd
          ? Object.fromEntries(Object.entries(current.manualOdds).filter(([houseId]) => current.autoOdd[houseId] === false))
          : current.manualOdds,
        autoMarketHouseIds: current.autoMarketHouseIds,
        pinnedHouseId: current.pinnedHouseId,
        minProfit: current.minProfit,
        totalStakeCents: current.autoStake ? null : manualStake,
        sort: current.sort,
      }),
    })
    if (!response.ok) return
    const data = (await response.json()) as {
      signals: BoardSignal[]
      totalStakeCents: number
      balanceCents: number
      alerted: string[]
    }
    setSignals(data.signals)
    setStakeCents(data.totalStakeCents)
    setBalance(data.balanceCents)
    if (data.alerted.length) {
      setAlerts((count) => count + data.alerted.length)
      window.__fsAlerts = (window.__fsAlerts ?? 0) + data.alerted.length
      beep(filtersRef.current.volume)
      setMessage(`Alerta: ${data.alerted.length} sinal novo.`)
    }
  }

  useEffect(() => {
    void pull(filtersRef.current)
    const timer = window.setInterval(() => void pull(filtersRef.current), Math.max(2, props.pollSeconds) * 1000)
    return () => window.clearInterval(timer)
  }, [props.pollSeconds])

  const visible = useMemo(() => {
    const query = filters.query.trim().toLocaleLowerCase("pt-BR")
    if (!query) return signals
    return signals.filter((signal) =>
      `${signal.eventName} ${signal.sportName} ${signal.market} ${signal.leg1.houseName} ${signal.leg2.houseName}`
        .toLocaleLowerCase("pt-BR")
        .includes(query),
    )
  }, [filters.query, signals])

  function patch(partial: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...partial }))
  }

  async function onLaunch(signal: BoardSignal) {
    setError("")
    const manualStake = centsFromInput(filters.manualStakeReais)
    const result = await launchStakeAction({
      phase: filters.phase,
      key: signal.key,
      houseIds: filters.houseIds,
      fixedSides: filters.fixedSides,
      manualOdds: Object.fromEntries(Object.entries(filters.manualOdds).filter(([houseId]) => filters.autoOdd[houseId] === false)),
      autoMarketHouseIds: filters.autoMarketHouseIds,
      pinnedHouseId: filters.pinnedHouseId,
      minProfit: filters.minProfit,
      totalStakeCents: filters.autoStake ? null : manualStake,
      sort: filters.sort,
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setBalance(result.balanceCents)
    setLaunched((current) => (current.includes(signal.key) ? current : [...current, signal.key]))
    setMessage(result.duplicate ? "Esse stake já estava na banca." : "Stake lançado na banca.")
  }

  async function onBank(kind: "entrada" | "ajuste") {
    setError("")
    const cents = centsFromInput(amount)
    if (cents == null || cents === 0) {
      setError("Informe o valor.")
      return
    }
    const result = await bankrollAction({ kind, amountCents: kind === "ajuste" ? -Math.abs(cents) : cents, note: kind === "entrada" ? "Entrada" : "Ajuste" })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setBalance(result.balanceCents)
    setMessage(kind === "entrada" ? "Entrada registrada." : "Ajuste registrado.")
  }

  async function onSupport() {
    setError("")
    const result = await supportAction({ kind: supportKind, body: supportBody })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSupportBody("")
    setMessage("Mensagem enviada ao suporte.")
  }

  const orderedHouses = [...props.houses].sort((a, b) => {
    if (filters.sort === "alfa") return a.name.localeCompare(b.name, "pt-BR")
    return a.cloneLabel.localeCompare(b.cloneLabel, "pt-BR") || a.name.localeCompare(b.name, "pt-BR")
  })

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal">Operação</p>
          <h1 className="font-display text-6xl uppercase">Sinais</h1>
          <p className="mt-1 text-sm text-mist">Odds de teste. Nenhuma casa está em coleta ao vivo.</p>
        </div>
        <div className="rounded-xl border border-line bg-card px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-mist">Banca</p>
          <p className="font-display text-4xl" data-bankroll={balance}>
            {formatMoney(balance, props.currency)}
          </p>
          <p className="text-xs text-mist">Stake sugerido {formatMoney(stakeCents, props.currency)}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Fase">
        {(["prelive", "live"] as const).map((phase) => (
          <button
            key={phase}
            type="button"
            className={filters.phase === phase ? "btn-primary" : "btn-ghost"}
            onClick={() => {
              patch({ phase })
              void pull({ ...filters, phase })
            }}
          >
            {phase === "prelive" ? "Pré-live" : "Ao vivo"}
          </button>
        ))}
      </div>

      {message ? (
        <p role="status" data-alerts={alerts} className="mt-4 rounded-md border border-line bg-felt px-3 py-2 text-sm text-signal">
          {message}
        </p>
      ) : (
        <p data-alerts={alerts} className="sr-only" />
      )}
      {error ? (
        <p role="alert" className="mt-4 rounded-md border border-[#6e3030] bg-[#2a1414] px-3 py-2 text-sm text-[#ffb4b4]">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="min-w-[12rem] flex-1">
          <span className="label">Busca</span>
          <input className="field" value={filters.query} placeholder="Evento ou casa" onChange={(event) => patch({ query: event.target.value })} />
        </label>
        <label>
          <span className="label">Lucro mínimo</span>
          <input
            className="field w-28"
            value={String(filters.minProfit)}
            inputMode="decimal"
            onChange={(event) => patch({ minProfit: Number(event.target.value.replace(",", ".")) || 0 })}
          />
        </label>
        <button type="button" className="btn-ghost" onClick={() => patch({ sort: filters.sort === "alfa" ? "clone" : "alfa" })}>
          {filters.sort === "alfa" ? "Ordem alfabética" : "Ordem por clone"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => patch({ houseIds: props.houses.map((house) => house.id) })}>
          Todas
        </button>
        <button type="button" className="btn-ghost" onClick={() => patch({ houseIds: [] })}>
          Nenhuma
        </button>
      </div>

      <div className="mt-4 grid max-h-52 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
        {orderedHouses.map((house) => {
          const checked = filters.houseIds.includes(house.id)
          return (
            <label key={house.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) =>
                  patch({
                    houseIds: event.target.checked
                      ? [...filters.houseIds, house.id]
                      : filters.houseIds.filter((id) => id !== house.id),
                  })
                }
              />
              <img src={house.logoUrl} alt="" width={28} height={28} className="h-7 w-7 rounded-md" />
              <span className="font-semibold">{house.name}</span>
              <span className="text-mist">{house.currency}</span>
              <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wide text-mist">{feedLabel(house.feed)}</span>
              {house.cloneLabel ? <span className="text-mist">clone {house.cloneLabel}</span> : null}
              <select
                className="field w-24 py-1"
                value={filters.fixedSides[house.id] ?? ""}
                onChange={(event) => patch({ fixedSides: { ...filters.fixedSides, [house.id]: event.target.value } })}
                aria-label={`Lado fixo de ${house.name}`}
              >
                <option value="">Lado livre</option>
                <option value="casa">Casa</option>
                <option value="fora">Fora</option>
                <option value="over">Over</option>
                <option value="under">Under</option>
              </select>
              <button
                type="button"
                className={filters.pinnedHouseId === house.id ? "btn-primary px-2 py-1" : "btn-ghost px-2 py-1"}
                onClick={() => patch({ pinnedHouseId: filters.pinnedHouseId === house.id ? null : house.id })}
              >
                {filters.pinnedHouseId === house.id ? "Fixada" : "Fixar"}
              </button>
              <label className="flex items-center gap-1 text-mist">
                <input
                  type="checkbox"
                  checked={filters.autoOdd[house.id] !== false}
                  onChange={(event) => patch({ autoOdd: { ...filters.autoOdd, [house.id]: event.target.checked } })}
                />
                Auto-odd
              </label>
              {filters.autoOdd[house.id] === false ? (
                <input
                  className="field w-20 py-1"
                  inputMode="decimal"
                  placeholder="Odd"
                  aria-label={`Odd manual de ${house.name}`}
                  onChange={(event) => {
                    const odd = Number(event.target.value.replace(",", "."))
                    patch({ manualOdds: { ...filters.manualOdds, [house.id]: odd } })
                  }}
                />
              ) : null}
              {house.slug === "pinnacle" || house.slug === "bcgame" ? (
                <label className="flex items-center gap-1 text-mist">
                  <input
                    type="checkbox"
                    checked={filters.autoMarketHouseIds.includes(house.id)}
                    onChange={(event) =>
                      patch({
                        autoMarketHouseIds: event.target.checked
                          ? [...filters.autoMarketHouseIds, house.id]
                          : filters.autoMarketHouseIds.filter((id) => id !== house.id),
                      })
                    }
                  />
                  Auto-mercado
                </label>
              ) : null}
            </label>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={filters.autoStake} onChange={(event) => patch({ autoStake: event.target.checked })} />
          Auto-stake ({props.stakePercent}% da banca)
        </label>
        {props.quickReais.map((value) => (
          <button key={value} type="button" className="btn-ghost" onClick={() => patch({ autoStake: false, manualStakeReais: String(value) })}>
            R$ {value}
          </button>
        ))}
        <label>
          <span className="label">Stake manual</span>
          <input className="field w-28" value={filters.manualStakeReais} onChange={(event) => patch({ manualStakeReais: event.target.value, autoStake: false })} />
        </label>
        <label>
          <span className="label">Volume do alerta</span>
          <input
            className="w-32"
            type="range"
            min={0}
            max={100}
            value={filters.volume}
            aria-label="Volume do alerta"
            onChange={(event) => {
              const volume = Number(event.target.value)
              patch({ volume })
              beep(volume)
            }}
          />
        </label>
        <button type="button" className="btn-primary" onClick={() => void pull(filters)}>
          Atualizar
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-felt text-xs uppercase tracking-wide text-mist">
            <tr>
              <th className="px-3 py-3 font-semibold">Esporte</th>
              <th className="px-3 py-3 font-semibold">Evento</th>
              <th className="px-3 py-3 font-semibold">Mercado</th>
              <th className="px-3 py-3 font-semibold">Casa 1</th>
              <th className="px-3 py-3 font-semibold">Casa 2</th>
              <th className="px-3 py-3 font-semibold">Lucro</th>
              <th className="px-3 py-3 font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((signal) => (
              <tr
                key={signal.key}
                data-signal={signal.key}
                data-profit={signal.profitPercent.toFixed(2)}
                data-highlight={signal.highlight ? "sim" : "nao"}
                className={signal.highlight ? "bg-[#163222]" : ""}
              >
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <img src={signal.sportImage} alt="" width={32} height={32} className="h-8 w-8 rounded-md" />
                    <span>{signal.sportName}</span>
                  </div>
                </td>
                <td className="px-3 py-3">{signal.eventName}</td>
                <td className="px-3 py-3">{signal.market}</td>
                <td className="px-3 py-3">
                  <Leg leg={signal.leg1} />
                </td>
                <td className="px-3 py-3">
                  <Leg leg={signal.leg2} />
                </td>
                <td className="px-3 py-3">
                  <p className="font-display text-2xl text-signal">{percentLabel(signal.profitPercent)}</p>
                  <p className="text-mist">{formatMoney(signal.profitCents, props.currency)}</p>
                  {signal.highlight ? <p className="text-xs font-semibold uppercase text-[#d7c07a]">Acima de 7%</p> : null}
                </td>
                <td className="px-3 py-3">
                  <button type="button" className="btn-primary" disabled={launched.includes(signal.key)} onClick={() => void onLaunch(signal)}>
                    {launched.includes(signal.key) ? "Na banca" : "Lançar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length ? <p className="px-4 py-10 text-center text-sm text-mist">Nenhuma surebet com essas casas agora.</p> : null}
      </div>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <form
          className="rounded-2xl border border-line bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault()
            void onBank("entrada")
          }}
        >
          <h2 className="font-display text-3xl uppercase">Banca</h2>
          <label className="mt-3 block">
            <span className="label">Valor em reais</span>
            <input className="field" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <div className="mt-3 flex gap-2">
            <button className="btn-primary" type="submit">
              Entrada
            </button>
            <button
              className="btn-ghost"
              type="button"
              onClick={() => void onBank("ajuste")}
            >
              Tirar ajuste
            </button>
          </div>
          <ul className="mt-4 space-y-1 text-sm text-mist">
            {props.entries.map((entry) => (
              <li key={entry.id}>
                {entry.kind} · {formatMoney(entry.amountCents, props.currency)} · {entry.note}
              </li>
            ))}
          </ul>
        </form>
        <form
          className="rounded-2xl border border-line bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault()
            void onSupport()
          }}
        >
          <h2 className="font-display text-3xl uppercase">Suporte</h2>
          <label className="mt-3 block">
            <span className="label">Tipo</span>
            <select className="field" value={supportKind} onChange={(event) => setSupportKind(event.target.value as "sugestao" | "bug")}>
              <option value="sugestao">Sugestão</option>
              <option value="bug">Bug</option>
            </select>
          </label>
          <label className="mt-3 block">
            <span className="label">Mensagem</span>
            <textarea className="field min-h-24" value={supportBody} onChange={(event) => setSupportBody(event.target.value)} />
          </label>
          <button className="btn-primary mt-3" type="submit">
            Enviar
          </button>
        </form>
      </section>
    </div>
  )
}

function Leg({ leg }: { leg: BoardSignal["leg1"] }) {
  return (
    <div className="flex items-center gap-2">
      <img src={leg.logoUrl} alt="" width={28} height={28} className="h-7 w-7 rounded-md" />
      <div>
        <p className="font-semibold">{leg.houseName}</p>
        <p className="text-mist">
          {sideLabel(leg.side)} · {oddLabel(leg.odd)} · {formatMoney(leg.stakeHouseCents, leg.currency)}
        </p>
        <p className="text-[10px] uppercase tracking-wide text-mist">{feedLabel(leg.feed)}</p>
      </div>
    </div>
  )
}
