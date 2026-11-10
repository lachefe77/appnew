"use client"

import { useMemo, useState } from "react"
import { formatMoney } from "@/lib/format"
import { stakesFor } from "@/server/surebet"

export function Calculator() {
  const [odd1, setOdd1] = useState("2.05")
  const [odd2, setOdd2] = useState("2.05")
  const [stake, setStake] = useState("100")
  const result = useMemo(() => {
    const total = Math.round(Number(stake.replace(",", ".")) * 100)
    return stakesFor(total, Number(odd1.replace(",", ".")), Number(odd2.replace(",", ".")))
  }, [odd1, odd2, stake])

  return (
    <form className="grid gap-3 rounded-2xl border border-line bg-white p-5" onSubmit={(event) => event.preventDefault()}>
      <label>
        <span className="label">Odd da casa</span>
        <input className="field" value={odd1} onChange={(event) => setOdd1(event.target.value)} />
      </label>
      <label>
        <span className="label">Odd de fora</span>
        <input className="field" value={odd2} onChange={(event) => setOdd2(event.target.value)} />
      </label>
      <label>
        <span className="label">Stake total (R$)</span>
        <input className="field" value={stake} onChange={(event) => setStake(event.target.value)} />
      </label>
      {result ? (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-mist">Stake casa</dt>
            <dd className="font-semibold">{formatMoney(result.stake1)}</dd>
          </div>
          <div>
            <dt className="text-mist">Stake fora</dt>
            <dd className="font-semibold">{formatMoney(result.stake2)}</dd>
          </div>
          <div>
            <dt className="text-mist">Lucro</dt>
            <dd className="font-semibold">{formatMoney(result.profitCents)}</dd>
          </div>
          <div>
            <dt className="text-mist">Percentual</dt>
            <dd className="font-semibold">{result.profitPercent.toFixed(2).replace(".", ",")}%</dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-mist">Essas duas odds não fecham surebet.</p>
      )}
    </form>
  )
}
