"use client";

import { useState } from "react";
import type { CommerceSettings } from "@/server/commerce";

export function SettingsForm({ initial }: { initial: CommerceSettings }) {
  const [form, setForm] = useState(initial);
  const [message, setMessage] = useState("");

  function setNumber(key: keyof CommerceSettings, value: string) {
    setForm({ ...form, [key]: Number(value) });
  }

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const response = await fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const body = (await response.json()) as { error?: string };
        setMessage(response.ok ? "Salvo. Pedidos novos usam estes números. As chaves de API continuam no ambiente." : body.error ?? "Falhou");
      }}
    >
      <label className="text-sm">Spread do atacado<input className="field mt-1" type="number" step="0.01" value={form.spread} onChange={(event) => setNumber("spread", event.target.value)} /></label>
      <label className="text-sm">Multiplicador do varejo<input className="field mt-1" type="number" step="0.01" value={form.retailMultiplier} onChange={(event) => setNumber("retailMultiplier", event.target.value)} /></label>
      <label className="text-sm">Recarga mínima em centavos<input className="field mt-1" type="number" value={form.minDepositCents} onChange={(event) => setNumber("minDepositCents", event.target.value)} /></label>
      <label className="text-sm">Lembrete de PIX em ms<input className="field mt-1" type="number" value={form.abandonedPixDelayMs} onChange={(event) => setNumber("abandonedPixDelayMs", event.target.value)} /></label>
      <label className="text-sm">Alerta do galpão em centavos<input className="field mt-1" type="number" value={form.lowBalanceCents} onChange={(event) => setNumber("lowBalanceCents", event.target.value)} /></label>
      <label className="text-sm">Alerta da CJ em centavos de dólar<input className="field mt-1" type="number" value={form.cjLowBalanceCents} onChange={(event) => setNumber("cjLowBalanceCents", event.target.value)} /></label>
      <label className="text-sm">Estoque mínimo para listar<input className="field mt-1" type="number" value={form.lowStockThreshold} onChange={(event) => setNumber("lowStockThreshold", event.target.value)} /></label>
      <label className="text-sm">Selo de últimas unidades abaixo de<input className="field mt-1" type="number" value={form.lowStockBadge} onChange={(event) => setNumber("lowStockBadge", event.target.value)} /></label>
      <label className="text-sm">Prazo padrão em dias úteis<input className="field mt-1" type="number" value={form.shipDays} onChange={(event) => setNumber("shipDays", event.target.value)} /></label>
      <div className="flex items-end">
        <button className="rounded-full bg-ink px-4 py-2 text-sm text-white">Salvar ajustes</button>
      </div>
      {message ? <p className="text-sm text-muted sm:col-span-2">{message}</p> : null}
    </form>
  );
}
