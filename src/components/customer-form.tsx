"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CustomerForm() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", cpf: "", phone: "", email: "" });
  const [message, setMessage] = useState("");

  return (
    <form
      className="grid max-w-xl gap-3 sm:grid-cols-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const response = await fetch("/api/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const body = (await response.json()) as { error?: string };
        setMessage(response.ok ? "Cliente salvo" : body.error ?? "Falhou");
        if (response.ok) router.refresh();
      }}
    >
      <input className="field" placeholder="Nome" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
      <input className="field" placeholder="CPF" value={form.cpf} onChange={(event) => setForm({ ...form, cpf: event.target.value })} required />
      <input className="field" placeholder="WhatsApp" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} required />
      <input className="field" placeholder="E-mail" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
      <button className="w-fit rounded-full bg-ink px-4 py-2 text-sm text-white">Salvar cliente</button>
      {message ? <p className="text-sm text-muted sm:col-span-2">{message}</p> : null}
    </form>
  );
}
