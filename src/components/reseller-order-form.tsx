"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui";
import { formatBRL } from "@/lib/format";

type ProductOption = { id: string; title: string; wholesaleCents: number; stockQuantity: number };

export function ResellerOrderForm({ products }: { products: ProductOption[] }) {
  const router = useRouter();
  const requestId = useRef(crypto.randomUUID());
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [customer, setCustomer] = useState({ name: "", cpf: "", phone: "", email: "" });
  const [address, setAddress] = useState({ cep: "", street: "", number: "", complement: "", district: "", city: "", state: "SP" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const selected = products.find((product) => product.id === productId);

  if (products.length === 0) {
    return <p className="text-sm text-muted">Importe um produto no catálogo para vender.</p>;
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
          body: JSON.stringify({ channel: "B2B", productId, quantity, clientRequestId: requestId.current, customer, address }),
        });
        const body = (await response.json()) as { publicCode?: string; error?: string };
        setLoading(false);
        if (!response.ok || !body.publicCode) {
          setError(body.error ?? "Não criou o pedido");
          requestId.current = crypto.randomUUID();
          return;
        }
        router.push(`/pedido/${body.publicCode}`);
        router.refresh();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Produto importado">
          <select className="field" value={productId} onChange={(event) => setProductId(event.target.value)}>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.title} · atacado {formatBRL(product.wholesaleCents)} · estoque {product.stockQuantity}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantidade">
          <input className="field" type="number" min={1} max={5} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
        </Field>
        <Field label="Cliente final"><input className="field" value={customer.name} onChange={(event) => setCustomer({ ...customer, name: event.target.value })} required /></Field>
        <Field label="CPF do cliente"><input className="field" value={customer.cpf} onChange={(event) => setCustomer({ ...customer, cpf: event.target.value })} required /></Field>
        <Field label="WhatsApp"><input className="field" value={customer.phone} onChange={(event) => setCustomer({ ...customer, phone: event.target.value })} required /></Field>
        <Field label="E-mail"><input className="field" value={customer.email} onChange={(event) => setCustomer({ ...customer, email: event.target.value })} /></Field>
        <Field label="CEP"><input className="field" value={address.cep} onChange={(event) => setAddress({ ...address, cep: event.target.value })} required /></Field>
        <Field label="Rua"><input className="field" value={address.street} onChange={(event) => setAddress({ ...address, street: event.target.value })} required /></Field>
        <Field label="Número"><input className="field" value={address.number} onChange={(event) => setAddress({ ...address, number: event.target.value })} required /></Field>
        <Field label="Bairro"><input className="field" value={address.district} onChange={(event) => setAddress({ ...address, district: event.target.value })} required /></Field>
        <Field label="Cidade"><input className="field" value={address.city} onChange={(event) => setAddress({ ...address, city: event.target.value })} required /></Field>
        <Field label="UF"><input className="field" maxLength={2} value={address.state} onChange={(event) => setAddress({ ...address, state: event.target.value })} required /></Field>
      </div>
      {selected ? (
        <p className="text-sm text-muted">
          A carteira será debitada em {formatBRL(selected.wholesaleCents * quantity)}. O cliente final não paga a plataforma neste fluxo.
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button disabled={loading} className="rounded-full bg-pine px-5 py-3 text-sm text-white disabled:opacity-60">
        {loading ? "Lançando…" : "Lançar pedido e despachar"}
      </button>
    </form>
  );
}
