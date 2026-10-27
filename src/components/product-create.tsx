"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const empty = {
  title: "",
  description: "",
  category: "ferramentas",
  supplierSource: "BLING_HUB",
  supplierSku: "",
  supplierCostCents: 10000,
  platformWholesaleCents: 14000,
  suggestedRetailCents: 19900,
  stockQuantity: 10,
  shipDays: 1,
};

export function ProductCreate() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [message, setMessage] = useState("");

  if (!open) {
    return (
      <button type="button" className="rounded-full bg-ink px-4 py-2 text-sm text-white" onClick={() => setOpen(true)}>
        Cadastrar produto
      </button>
    );
  }

  return (
    <form
      className="grid gap-3 rounded-2xl border border-line bg-card p-4 sm:grid-cols-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const response = await fetch("/api/admin/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", ...form }),
        });
        const body = (await response.json()) as { error?: string };
        setMessage(response.ok ? "Produto no catálogo. A foto entra no card abaixo." : body.error ?? "Não cadastrou");
        if (response.ok) {
          setForm(empty);
          setOpen(false);
          router.refresh();
        }
      }}
    >
      <label className="text-sm sm:col-span-2">Título<input className="field mt-1" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></label>
      <label className="text-sm sm:col-span-2">Descrição<textarea className="field mt-1 min-h-20" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required /></label>
      <label className="text-sm">Categoria
        <select className="field mt-1" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
          <option value="ferramentas">Ferramentas</option>
          <option value="bem-estar">Bem-estar</option>
          <option value="pet">Pet</option>
        </select>
      </label>
      <label className="text-sm">Origem
        <select className="field mt-1" value={form.supplierSource} onChange={(event) => setForm({ ...form, supplierSource: event.target.value })}>
          <option value="BLING_HUB">Galpão nacional</option>
          <option value="CJ_BRAZIL">Armazém CJ</option>
        </select>
      </label>
      <label className="text-sm">SKU<input className="field mt-1" value={form.supplierSku} onChange={(event) => setForm({ ...form, supplierSku: event.target.value })} required /></label>
      <label className="text-sm">Estoque<input className="field mt-1" type="number" value={form.stockQuantity} onChange={(event) => setForm({ ...form, stockQuantity: Number(event.target.value) })} /></label>
      <label className="text-sm">Custo em centavos<input className="field mt-1" type="number" value={form.supplierCostCents} onChange={(event) => setForm({ ...form, supplierCostCents: Number(event.target.value) })} /></label>
      <label className="text-sm">Atacado em centavos<input className="field mt-1" type="number" value={form.platformWholesaleCents} onChange={(event) => setForm({ ...form, platformWholesaleCents: Number(event.target.value) })} /></label>
      <label className="text-sm">Varejo em centavos<input className="field mt-1" type="number" value={form.suggestedRetailCents} onChange={(event) => setForm({ ...form, suggestedRetailCents: Number(event.target.value) })} /></label>
      <label className="text-sm">Dias úteis<input className="field mt-1" type="number" value={form.shipDays} onChange={(event) => setForm({ ...form, shipDays: Number(event.target.value) })} /></label>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button className="rounded-full bg-ink px-4 py-2 text-sm text-white">Salvar produto</button>
        <button type="button" className="rounded-full border border-line px-4 py-2 text-sm" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
      {message ? <p className="text-sm text-muted sm:col-span-2">{message}</p> : null}
    </form>
  );
}
