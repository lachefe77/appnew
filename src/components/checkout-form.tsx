"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui";

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

export function CheckoutForm({ productId, quantity = 1 }: { productId: string; quantity?: number }) {
  const router = useRouter();
  const requestId = useRef(crypto.randomUUID());
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function set(key: keyof typeof empty, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setLoading(true);
        setError("");
        const response = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: "B2C",
            productId,
            quantity,
            clientRequestId: requestId.current,
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
        const body = (await response.json()) as { publicCode?: string; error?: string };
        setLoading(false);
        if (!response.ok || !body.publicCode) {
          setError(body.error ?? "Não foi possível abrir o pedido");
          requestId.current = crypto.randomUUID();
          return;
        }
        router.push(`/pedido/${body.publicCode}`);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome"><input className="field" value={form.name} onChange={(event) => set("name", event.target.value)} required /></Field>
        <Field label="CPF"><input className="field" inputMode="numeric" value={form.cpf} onChange={(event) => set("cpf", event.target.value)} required /></Field>
        <Field label="WhatsApp"><input className="field" inputMode="tel" value={form.phone} onChange={(event) => set("phone", event.target.value)} required /></Field>
        <Field label="E-mail"><input className="field" type="email" value={form.email} onChange={(event) => set("email", event.target.value)} /></Field>
        <Field label="CEP"><input className="field" inputMode="numeric" value={form.cep} onChange={(event) => set("cep", event.target.value)} required /></Field>
        <Field label="Rua"><input className="field" value={form.street} onChange={(event) => set("street", event.target.value)} required /></Field>
        <Field label="Número"><input className="field" value={form.number} onChange={(event) => set("number", event.target.value)} required /></Field>
        <Field label="Complemento"><input className="field" value={form.complement} onChange={(event) => set("complement", event.target.value)} /></Field>
        <Field label="Bairro"><input className="field" value={form.district} onChange={(event) => set("district", event.target.value)} required /></Field>
        <Field label="Cidade"><input className="field" value={form.city} onChange={(event) => set("city", event.target.value)} required /></Field>
        <Field label="UF"><input className="field" maxLength={2} value={form.state} onChange={(event) => set("state", event.target.value)} required /></Field>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button disabled={loading} className="rounded-full bg-copper px-5 py-3 text-sm font-medium text-white disabled:opacity-60">
        {loading ? "Gerando PIX…" : "Gerar PIX do pedido"}
      </button>
    </form>
  );
}
