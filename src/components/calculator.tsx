"use client"

import { useMemo, useState } from "react"
import { formatMoney } from "@/lib/format"
import { quoteProblem, stakeForTarget, stakesForMany } from "@/server/surebet"

export function Calculator() {
  const [mode, setMode] = useState<"duas" | "tres" | "inverso">("duas")
  const [odd1, setOdd1] = useState("2.05")
  const [odd2, setOdd2] = useState("2.05")
  const [odd3, setOdd3] = useState("3.40")
  const [stake, setStake] = useState("100")
  const [target, setTarget] = useState("10")
  const odds = [odd1, odd2, mode === "tres" ? odd3 : ""].filter(Boolean).map((value) => Number(value.replace(",", ".")))
  const problem = quoteProblem(mode === "duas" ? odds.slice(0, 2) : odds)
  const result = useMemo(() => {
    const used = mode === "duas" ? odds.slice(0, 2) : odds
    if (quoteProblem(used)) return null
    if (mode === "inverso") {
      const cents = Math.round(Number(target.replace(",", ".")) * 100)
      return stakeForTarget(cents, used.slice(0, 2))
    }
    const total = Math.round(Number(stake.replace(",", ".")) * 100)
    return stakesForMany(total, used)
  }, [mode, odd1, odd2, odd3, stake, target])

  return (
    <form className="grid gap-3 border border-line bg-card p-5" onSubmit={(event) => event.preventDefault()}>
      <div className="flex gap-2">
        {(["duas", "tres", "inverso"] as const).map((item) => (
          <button key={item} type="button" className={mode === item ? "btn-primary" : "btn-ghost"} onClick={() => setMode(item)}>
            {item === "duas" ? "2 odds" : item === "tres" ? "1x2" : "Lucro alvo"}
          </button>
        ))}
      </div>
      <label>
        <span className="label">Odd 1</span>
        <input className="field" value={odd1} onChange={(event) => setOdd1(event.target.value)} />
      </label>
      <label>
        <span className="label">Odd 2</span>
        <input className="field" value={odd2} onChange={(event) => setOdd2(event.target.value)} />
      </label>
      {mode === "tres" ? (
        <label>
          <span className="label">Odd do empate</span>
          <input className="field" value={odd3} onChange={(event) => setOdd3(event.target.value)} />
        </label>
      ) : null}
      {mode === "inverso" ? (
        <label>
          <span className="label">Lucro desejado (R$)</span>
          <input className="field" value={target} onChange={(event) => setTarget(event.target.value)} />
        </label>
      ) : (
        <label>
          <span className="label">Stake total (R$)</span>
          <input className="field" value={stake} onChange={(event) => setStake(event.target.value)} />
        </label>
      )}
      {problem ? <p className="text-sm text-[#8d2b2b]">{problem}</p> : null}
      {result ? (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {result.stakes.map((value, index) => (
            <div key={index}>
              <dt className="text-mist">Stake {index + 1}</dt>
              <dd className="font-semibold">{formatMoney(value)}</dd>
            </div>
          ))}
          <div>
            <dt className="text-mist">Lucro</dt>
            <dd className="font-semibold">{formatMoney(result.profitCents)}</dd>
          </div>
          <div>
            <dt className="text-mist">Percentual</dt>
            <dd className="font-semibold">{result.profitPercent.toFixed(2).replace(".", ",")}%</dd>
          </div>
        </dl>
      ) : null}
    </form>
  )
}
