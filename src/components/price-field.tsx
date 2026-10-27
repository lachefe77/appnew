"use client";

import { useState } from "react";

export function PriceField({ productId, cents }: { productId: string; cents: number }) {
  const [value, setValue] = useState((cents / 100).toFixed(2));
  const [message, setMessage] = useState("");
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const response = await fetch("/api/catalog/price", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId, retailPriceCents: Math.round(Number(value.replace(",", ".")) * 100) }),
        });
        setMessage(response.ok ? "Preço salvo" : "Não salvou");
      }}
    >
      <input className="field w-28" value={value} onChange={(event) => setValue(event.target.value)} />
      <button className="rounded-full bg-ink px-3 py-2 text-sm text-white">Salvar</button>
      {message ? <span className="text-xs text-muted">{message}</span> : null}
    </form>
  );
}
