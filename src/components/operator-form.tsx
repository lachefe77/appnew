"use client";

import { useState } from "react";

export function OperatorForm() {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [message, setMessage] = useState("");

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const response = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "operator", ...form }),
        });
        const body = (await response.json()) as { error?: string };
        setMessage(response.ok ? "Operador criado. Ele entra em /entrar." : body.error ?? "Falhou");
      }}
    >
      <input className="field" placeholder="Nome" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
      <input className="field" placeholder="E-mail" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
      <input className="field" placeholder="Senha" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
      <button className="w-fit rounded-full bg-ink px-4 py-2 text-sm text-white">Criar operador</button>
      {message ? <p className="text-sm text-muted">{message}</p> : null}
    </form>
  );
}
