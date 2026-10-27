"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { readCart, writeCart, type CartLine } from "@/components/cart-button";
import { formatBRL } from "@/lib/format";

const empty = {
  name: "",
  cpf: "",
  phone: "",
  email: "",
  cep: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "",
};

export default function CheckoutPage() {
  const router = useRouter();
  const requestId = useRef("");
  const [lines, setLines] = useState<CartLine[]>([]);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState(empty);
  const [payMethod, setPayMethod] = useState<"PIX" | "BOLETO" | "USDT">("PIX");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLines(readCart());
    requestId.current = crypto.randomUUID();
  }, []);

  function set(key: keyof typeof empty, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const total = lines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0);

  async function pay() {
    setLoading(true);
    setError("");
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
        clientRequestId: requestId.current,
        payMethod,
        customer: { name: form.name, cpf: form.cpf, phone: form.phone, email: form.email },
        address: {
          cep: form.cep,
          street: form.street,
          number: form.number,
          complement: form.complement,
          district: form.district,
          city: form.city,
          state: form.state,
        },
      }),
    });
    const body = (await response.json()) as { publicCode?: string; publicCodes?: string[]; error?: string };
    setLoading(false);
    if (!response.ok || !body.publicCode) {
      setError(body.error ?? "Não gerou o PIX");
      requestId.current = crypto.randomUUID();
      return;
    }
    writeCart([]);
    const codes = body.publicCodes ?? [body.publicCode];
    if (codes.length === 1) router.push(`/pedido/${codes[0]}`);
    else router.push(`/meus-pedidos?criados=${codes.join(",")}`);
  }

  if (lines.length === 0) {
    return (
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold">Checkout</h1>
        <p className="text-muted">O carrinho está vazio.</p>
        <Link href="/" className="text-pine">Voltar à vitrine</Link>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
      <div className="space-y-5">
        <h1 className="text-3xl font-semibold">Checkout</h1>
        <p className="text-sm text-muted">Etapa {step} de 3 · dados, endereço, revisão</p>
        {step === 1 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Nome<input className="field mt-1" value={form.name} onChange={(event) => set("name", event.target.value)} /></label>
            <label className="text-sm">CPF<input className="field mt-1" value={form.cpf} onChange={(event) => set("cpf", event.target.value)} /></label>
            <label className="text-sm">WhatsApp<input className="field mt-1" value={form.phone} onChange={(event) => set("phone", event.target.value)} /></label>
            <label className="text-sm">E-mail<input className="field mt-1" value={form.email} onChange={(event) => set("email", event.target.value)} /></label>
          </div>
        ) : null}
        {step === 2 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">CEP<input className="field mt-1" value={form.cep} onChange={(event) => set("cep", event.target.value)} /></label>
            <label className="text-sm">Rua<input className="field mt-1" value={form.street} onChange={(event) => set("street", event.target.value)} /></label>
            <label className="text-sm">Número<input className="field mt-1" value={form.number} onChange={(event) => set("number", event.target.value)} /></label>
            <label className="text-sm">Complemento<input className="field mt-1" value={form.complement} onChange={(event) => set("complement", event.target.value)} /></label>
            <label className="text-sm">Bairro<input className="field mt-1" value={form.district} onChange={(event) => set("district", event.target.value)} /></label>
            <label className="text-sm">Cidade<input className="field mt-1" value={form.city} onChange={(event) => set("city", event.target.value)} /></label>
            <label className="text-sm">UF<input className="field mt-1" value={form.state} onChange={(event) => set("state", event.target.value)} maxLength={2} /></label>
          </div>
        ) : null}
        {step === 3 ? (
          <div className="rounded-2xl border border-line bg-card p-4 text-sm">
            <p>{form.name} · {form.cpf}</p>
            <p className="text-muted">{form.street}, {form.number} · {form.city}/{form.state}</p>
            <p className="mt-3">Escolha como pagar. Cartão não entra. Itens de galpões diferentes viram pedidos separados.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["PIX", "BOLETO", "USDT"] as const).map((method) => (
                <button key={method} type="button" className={`rounded-md border px-3 py-2 text-sm ${payMethod === method ? "border-ink bg-ink text-white" : "border-line"}`} onClick={() => setPayMethod(method)}>
                  {method === "BOLETO" ? "Boleto" : method}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex gap-2">
          {step > 1 ? <button type="button" className="rounded-full border border-line px-4 py-2 text-sm" onClick={() => setStep((step - 1) as 1 | 2 | 3)}>Voltar</button> : null}
          {step < 3 ? <button type="button" className="rounded-full bg-ink px-4 py-2 text-sm text-white" onClick={() => setStep((step + 1) as 1 | 2 | 3)}>Continuar</button> : null}
          {step === 3 ? <button type="button" disabled={loading} className="rounded-full bg-copper px-4 py-2 text-sm text-white disabled:opacity-60" onClick={pay}>{loading ? "Gerando..." : payMethod === "PIX" ? "Gerar PIX" : payMethod === "BOLETO" ? "Gerar boleto" : "Pagar com USDT"}</button> : null}
        </div>
      </div>
      <aside className="h-fit rounded-2xl border border-line bg-card p-4">
        <p className="font-medium">Pedido</p>
        <ul className="mt-3 space-y-2 text-sm">
          {lines.map((line) => (
            <li key={line.productId} className="flex justify-between gap-3">
              <span>{line.quantity}× {line.title}</span>
              <span>{formatBRL(line.unitCents * line.quantity)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 font-semibold">Total estimado {formatBRL(total)}</p>
        <p className="mt-1 text-xs text-muted">Kit do tipo leve 2 é aplicado no servidor. O total do PIX pode ficar menor que esta soma.</p>
      </aside>
    </div>
  );
}
