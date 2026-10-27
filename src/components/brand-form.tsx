"use client";

import { useState } from "react";
import type { StoreBrand } from "@/server/brand";

export function BrandForm({ initial }: { initial: StoreBrand }) {
  const [form, setForm] = useState(initial);
  const [message, setMessage] = useState("");

  function setText(key: keyof StoreBrand, value: string) {
    setForm({ ...form, [key]: value });
  }

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const response = await fetch("/api/admin/brand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            usdtBrlCents: Number(form.usdtBrlCents),
            affiliateBps: Number(form.affiliateBps),
          }),
        });
        const body = (await response.json()) as { error?: string };
        setMessage(response.ok ? "A vitrine passou a usar estes textos." : body.error ?? "Falhou");
      }}
    >
      <label className="text-sm">Nome do site<input className="field mt-1" value={form.name} onChange={(event) => setText("name", event.target.value)} /></label>
      <label className="text-sm">Sigla do logo<input className="field mt-1" value={form.mark} onChange={(event) => setText("mark", event.target.value)} /></label>
      <label className="text-sm sm:col-span-2">Linha abaixo do nome<input className="field mt-1" value={form.tagline} onChange={(event) => setText("tagline", event.target.value)} /></label>
      <label className="text-sm sm:col-span-2">Título da vitrine<input className="field mt-1" value={form.heroTitle} onChange={(event) => setText("heroTitle", event.target.value)} /></label>
      <label className="text-sm sm:col-span-2">Texto da vitrine<textarea className="field mt-1 min-h-24" value={form.heroBody} onChange={(event) => setText("heroBody", event.target.value)} /></label>
      <label className="text-sm">Despacho<input className="field mt-1" value={form.dispatchLabel} onChange={(event) => setText("dispatchLabel", event.target.value)} /></label>
      <label className="text-sm">Galpão<input className="field mt-1" value={form.warehouseLabel} onChange={(event) => setText("warehouseLabel", event.target.value)} /></label>
      <label className="text-sm">Fornecedor<input className="field mt-1" value={form.supplierLabel} onChange={(event) => setText("supplierLabel", event.target.value)} /></label>
      <label className="text-sm">Envio<input className="field mt-1" value={form.shippingLabel} onChange={(event) => setText("shippingLabel", event.target.value)} /></label>
      <label className="text-sm">E-mail do suporte<input className="field mt-1" value={form.supportEmail} onChange={(event) => setText("supportEmail", event.target.value)} /></label>
      <label className="text-sm">Rede USDT<input className="field mt-1" value={form.usdtNetwork} onChange={(event) => setText("usdtNetwork", event.target.value)} /></label>
      <label className="text-sm sm:col-span-2">Endereço USDT<input className="field mt-1" value={form.usdtAddress} onChange={(event) => setText("usdtAddress", event.target.value)} placeholder="Cole a carteira que recebe USDT" /></label>
      <label className="text-sm">Cotação USDT em centavos de real<input className="field mt-1" type="number" value={form.usdtBrlCents} onChange={(event) => setForm({ ...form, usdtBrlCents: Number(event.target.value) })} /></label>
      <label className="text-sm">Comissão do afiliado em pontos-base<input className="field mt-1" type="number" value={form.affiliateBps} onChange={(event) => setForm({ ...form, affiliateBps: Number(event.target.value) })} /></label>
      <div className="sm:col-span-2">
        <button className="rounded-full bg-ink px-4 py-2 text-sm text-white">Salvar vitrine</button>
        {message ? <p className="mt-2 text-sm text-muted">{message}</p> : null}
        <p className="mt-2 text-xs text-muted">200 pontos-base são 2% do atacado. A cotação só estima o USDT na tela. A confirmação continua manual.</p>
      </div>
    </form>
  );
}
