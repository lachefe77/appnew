"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdjustForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("50.00");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  return (
    <form
      className="grid gap-2 rounded-2xl border border-line bg-card p-4 sm:grid-cols-[140px_1fr_auto]"
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        const cents = Math.round(Number(amount.replace(",", ".")) * 100);
        const response = await fetch("/api/admin/wallet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, amountCents: cents, reason }),
        });
        const body = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(body.error ?? "Não ajustou");
          return;
        }
        setReason("");
        router.refresh();
      }}
    >
      <input className="field" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="50.00 ou -20.00" />
      <input className="field" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo do ajuste" required />
      <button className="rounded-full bg-ink px-4 py-2 text-sm text-white">Lançar ajuste</button>
      {error ? <p className="text-sm text-red-700 sm:col-span-3">{error}</p> : null}
    </form>
  );
}
