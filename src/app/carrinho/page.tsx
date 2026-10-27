"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readCart, writeCart, type CartLine } from "@/components/cart-button";
import { formatBRL } from "@/lib/format";

export default function CartPage() {
  const [lines, setLines] = useState<CartLine[]>([]);

  useEffect(() => {
    setLines(readCart());
  }, []);

  function update(productId: string, quantity: number) {
    const next = quantity <= 0 ? lines.filter((line) => line.productId !== productId) : lines.map((line) => (line.productId === productId ? { ...line, quantity } : line));
    setLines(next);
    writeCart(next);
  }

  const total = lines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0);

  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-semibold">Carrinho</h1>
      {lines.length === 0 ? <p className="text-muted">Nenhum item. A vitrine está em <Link href="/" className="text-pine">abrir catálogo</Link>.</p> : null}
      <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
        {lines.map((line) => (
          <li key={line.productId} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">{line.title}</p>
              <p className="text-sm text-muted">Envio em até {line.shipDays} dias úteis · {formatBRL(line.unitCents)}</p>
            </div>
            <div className="flex items-center gap-2">
              <input className="field w-20" type="number" min={1} max={5} value={line.quantity} onChange={(event) => update(line.productId, Number(event.target.value))} />
              <button type="button" className="text-sm text-muted" onClick={() => update(line.productId, 0)}>Tirar</button>
            </div>
          </li>
        ))}
      </ul>
      {lines.length > 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-xl font-semibold">{formatBRL(total)}</p>
          <Link href="/checkout" className="rounded-full bg-ink px-4 py-2 text-sm text-white">Ir para o checkout</Link>
        </div>
      ) : null}
    </div>
  );
}
