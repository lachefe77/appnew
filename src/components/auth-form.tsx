"use client";

import { useState } from "react";
import { Field } from "@/components/ui";

export function LoginForm({ next, demo }: { next?: string; demo: boolean }) {
  const [email, setEmail] = useState(demo ? "revenda@novoshorizontes.test" : "");
  const [password, setPassword] = useState(demo ? "Revenda#Horizonte" : "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setLoading(true);
        setError("");
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, next }),
        });
        const body = (await response.json()) as { next?: string; error?: string };
        setLoading(false);
        if (!response.ok || !body.next) {
          setError(body.error ?? "Não entrou");
          return;
        }
        window.location.href = body.next;
      }}
    >
      <Field label="E-mail"><input className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></Field>
      <Field label="Senha"><input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></Field>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button disabled={loading} className="w-full rounded-full bg-ink py-3 text-sm text-paper disabled:opacity-60">
        {loading ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

export function RegisterForm({ reseller }: { reseller?: boolean }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    phone: "",
    cpfCnpj: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setLoading(true);
        setError("");
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, role: reseller ? "RESELLER" : "CUSTOMER" }),
        });
        const body = (await response.json()) as { next?: string; error?: string };
        setLoading(false);
        if (!response.ok || !body.next) {
          setError(body.error ?? "Não criou a conta");
          return;
        }
        window.location.href = body.next;
      }}
    >
      <Field label="Nome"><input className="field" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></Field>
      <Field label="E-mail"><input className="field" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></Field>
      <Field label="Senha"><input className="field" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></Field>
      <Field label="WhatsApp"><input className="field" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} required /></Field>
      <Field label="CPF ou CNPJ"><input className="field" value={form.cpfCnpj} onChange={(event) => setForm({ ...form, cpfCnpj: event.target.value })} required /></Field>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button disabled={loading} className="w-full rounded-full bg-copper py-3 text-sm text-white disabled:opacity-60">
        {loading ? "Criando…" : reseller ? "Abrir conta de revenda" : "Criar conta"}
      </button>
    </form>
  );
}
