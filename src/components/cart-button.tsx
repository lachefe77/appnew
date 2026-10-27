"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type CartLine = {
  productId: string;
  title: string;
  slug: string;
  quantity: number;
  unitCents: number;
  image?: string;
  shipDays: number;
};

const KEY = "nh-cart";

export function readCart(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as CartLine[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeCart(lines: CartLine[]) {
  window.localStorage.setItem(KEY, JSON.stringify(lines));
}

export function addLine(line: CartLine, replace = false) {
  const current = replace ? [] : readCart();
  const existing = current.find((item) => item.productId === line.productId);
  const next = existing
    ? current.map((item) => (item.productId === line.productId ? { ...item, quantity: Math.min(5, item.quantity + line.quantity) } : item))
    : [...current, line];
  writeCart(next);
  return next;
}

export function CartActions({ line }: { line: CartLine }) {
  const router = useRouter();
  const [note, setNote] = useState("");

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className="rounded-full bg-ink px-4 py-2.5 text-sm text-white"
        onClick={() => {
          addLine(line);
          setNote("No carrinho.");
        }}
      >
        Adicionar ao carrinho
      </button>
      <button
        type="button"
        className="rounded-full bg-copper px-4 py-2.5 text-sm text-white"
        onClick={() => {
          addLine(line, true);
          router.push("/checkout");
        }}
      >
        Comprar agora
      </button>
      {note ? <span className="self-center text-sm text-pine">{note}</span> : null}
    </div>
  );
}
