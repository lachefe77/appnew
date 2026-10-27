"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ProductDraft = {
  id: string;
  title: string;
  description: string;
  platformWholesaleCents: number;
  suggestedRetailCents: number;
  isActive: boolean;
  shipDays: number;
  bundleQty: number | null;
  bundlePriceCents: number | null;
};

export function ProductEditor({ product }: { product: ProductDraft }) {
  const router = useRouter();
  const [draft, setDraft] = useState(product);
  const [message, setMessage] = useState("");

  return (
    <form
      className="space-y-3 rounded-2xl border border-line bg-card p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const response = await fetch("/api/admin/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        const body = (await response.json()) as { error?: string };
        setMessage(response.ok ? "Salvo. O sync não cobre mais este preço." : body.error ?? "Falhou");
        router.refresh();
      }}
    >
      <input className="field" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      <textarea className="field min-h-20" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="text-xs text-muted">Atacado em centavos
          <input className="field" type="number" value={draft.platformWholesaleCents} onChange={(event) => setDraft({ ...draft, platformWholesaleCents: Number(event.target.value) })} />
        </label>
        <label className="text-xs text-muted">Varejo em centavos
          <input className="field" type="number" value={draft.suggestedRetailCents} onChange={(event) => setDraft({ ...draft, suggestedRetailCents: Number(event.target.value) })} />
        </label>
        <label className="text-xs text-muted">Dias úteis
          <input className="field" type="number" value={draft.shipDays} onChange={(event) => setDraft({ ...draft, shipDays: Number(event.target.value) })} />
        </label>
        <label className="text-xs text-muted">Ativo
          <select className="field" value={draft.isActive ? "sim" : "nao"} onChange={(event) => setDraft({ ...draft, isActive: event.target.value === "sim" })}>
            <option value="sim">Sim</option>
            <option value="nao">Não</option>
          </select>
        </label>
        <label className="text-xs text-muted">Leve N
          <input className="field" type="number" value={draft.bundleQty ?? ""} onChange={(event) => setDraft({ ...draft, bundleQty: event.target.value ? Number(event.target.value) : null })} />
        </label>
        <label className="text-xs text-muted">Preço do kit em centavos
          <input className="field" type="number" value={draft.bundlePriceCents ?? ""} onChange={(event) => setDraft({ ...draft, bundlePriceCents: event.target.value ? Number(event.target.value) : null })} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="rounded-full bg-ink px-4 py-2 text-sm text-white">Salvar produto</button>
        <label className="text-sm text-muted">
          Foto
          <input
            className="ml-2 text-sm"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const form = new FormData();
              form.set("id", product.id);
              form.set("file", file);
              const response = await fetch("/api/admin/products/photo", { method: "POST", body: form });
              setMessage(response.ok ? "Foto adicionada" : "A foto não entrou");
              router.refresh();
            }}
          />
        </label>
        {message ? <span className="text-sm text-muted">{message}</span> : null}
      </div>
    </form>
  );
}
