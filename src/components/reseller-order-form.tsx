"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui";
import { formatBRL } from "@/lib/format";

type ProductOption = { id: string; title: string; wholesaleCents: number; stockQuantity: number; retailCents: number };
type SavedCustomer = { name: string; cpf: string; phone: string; email?: string | null };

export function ResellerOrderForm({ products, customers = [] }: { products: ProductOption[]; customers?: SavedCustomer[] }) {
  const router = useRouter();
  const requestId = useRef(crypto.randomUUID());
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [customer, setCustomer] = useState({ name: "", cpf: "", phone: "", email: "" });
  const [address, setAddress] = useState({ cep: "", street: "", number: "", complement: "", district: "", city: "", state: "SP" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const chosen = products.filter((product) => (quantities[product.id] ?? 0) > 0);
  const debit = chosen.reduce((sum, product) => sum + product.wholesaleCents * (quantities[product.id] ?? 0), 0);

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
        if (chosen.length === 0) {
          setLoading(false);
          setError("Informe a quantidade de ao menos um produto");
          return;
        }
        const response = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: "B2B",
            items: chosen.map((product) => ({ productId: product.id, quantity: quantities[product.id] })),
            clientRequestId: requestId.current,
            customer,
            address,
          }),
        });
        const body = (await response.json()) as { publicCode?: string; publicCodes?: string[]; error?: string };
        setLoading(false);
        if (!response.ok || !body.publicCode) {
          setError(body.error ?? "Não criou o pedido");
          requestId.current = crypto.randomUUID();
          return;
        }
        const codes = body.publicCodes ?? [body.publicCode];
        router.push(codes.length > 1 ? `/painel/pedidos` : `/pedido/${codes[0]}`);
        router.refresh();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cliente salvo">
          <select
            className="field"
            defaultValue=""
            onChange={(event) => {
              const saved = customers.find((item) => item.cpf === event.target.value);
              if (!saved) return;
              setCustomer({ name: saved.name, cpf: saved.cpf, phone: saved.phone, email: saved.email ?? "" });
            }}
          >
            <option value="">Digitar agora</option>
            {customers.map((item) => (
              <option key={item.cpf} value={item.cpf}>{item.name}</option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2 space-y-2">
          {products.map((product) => (
            <label key={product.id} className="flex items-center justify-between gap-3 text-sm">
              <span>{product.title} · atacado {formatBRL(product.wholesaleCents)} · seu preço {formatBRL(product.retailCents)} · estoque {product.stockQuantity}</span>
              <input
                className="field w-20"
                type="number"
                min={0}
                max={5}
                value={quantities[product.id] ?? 0}
                onChange={(event) => setQuantities({ ...quantities, [product.id]: Number(event.target.value) })}
              />
            </label>
          ))}
        </div>
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
      {chosen.length > 0 ? (
        <p className="text-sm text-muted">
          A carteira será debitada em {formatBRL(debit)}. O cliente final não paga a plataforma neste fluxo. Itens de galpões diferentes viram pedidos separados.
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button disabled={loading} className="rounded-full bg-pine px-5 py-3 text-sm text-white disabled:opacity-60">
        {loading ? "Lançando…" : "Lançar pedido e despachar"}
      </button>
    </form>
  );
}
