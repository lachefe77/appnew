"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ContactForm() {
  const [message, setMessage] = useState("");
  return (
    <form
      className="grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const response = await fetch("/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.fromEntries(form.entries())),
        });
        const body = (await response.json()) as { error?: string };
        setMessage(response.ok ? "Mensagem recebida. O suporte vê isso na aba Contatos." : body.error ?? "Não enviou");
      }}
    >
      <input className="field" name="name" placeholder="Nome" required />
      <input className="field" name="email" type="email" placeholder="E-mail" required />
      <input className="field" name="phone" placeholder="WhatsApp" />
      <input className="field" name="subject" placeholder="Assunto" required />
      <textarea className="field min-h-28" name="body" placeholder="Mensagem" required />
      <button className="w-fit rounded-full bg-ink px-4 py-2 text-sm text-white">Enviar</button>
      {message ? <p className="text-sm text-muted">{message}</p> : null}
    </form>
  );
}

export function SupportForm({ name, email }: { name?: string; email?: string }) {
  const [message, setMessage] = useState("");
  return (
    <form
      className="grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const response = await fetch("/api/support", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.fromEntries(form.entries())),
        });
        const body = (await response.json()) as { error?: string };
        setMessage(response.ok ? "Chamado aberto. A resposta aparece nesta página depois do login." : body.error ?? "Não abriu");
      }}
    >
      <input className="field" name="name" defaultValue={name} placeholder="Nome" required />
      <input className="field" name="email" type="email" defaultValue={email} placeholder="E-mail" required />
      <input className="field" name="subject" placeholder="Assunto" required />
      <textarea className="field min-h-28" name="body" placeholder="O que aconteceu" required />
      <button className="w-fit rounded-full bg-ink px-4 py-2 text-sm text-white">Abrir chamado</button>
      {message ? <p className="text-sm text-muted">{message}</p> : null}
    </form>
  );
}

export function JobForm() {
  const [message, setMessage] = useState("");
  return (
    <form
      className="grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const response = await fetch("/api/jobs", { method: "POST", body: new FormData(event.currentTarget) });
        const body = (await response.json()) as { error?: string };
        setMessage(response.ok ? "Currículo recebido." : body.error ?? "Não enviou");
      }}
    >
      <input className="field" name="name" placeholder="Nome" required />
      <input className="field" name="email" type="email" placeholder="E-mail" required />
      <input className="field" name="phone" placeholder="WhatsApp" required />
      <input className="field" name="city" placeholder="Cidade" required />
      <input className="field" name="roleWanted" placeholder="Cargo de interesse" required />
      <textarea className="field min-h-28" name="message" placeholder="Conte o que você faz" required />
      <label className="text-sm text-muted">Currículo em PDF ou Word<input className="mt-1 block text-sm" name="resume" type="file" accept=".pdf,.doc,.docx" /></label>
      <button className="w-fit rounded-full bg-ink px-4 py-2 text-sm text-white">Enviar currículo</button>
      {message ? <p className="text-sm text-muted">{message}</p> : null}
    </form>
  );
}

export function ReplyForm({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const response = await fetch("/api/support/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketId, body }),
        });
        const payload = (await response.json()) as { error?: string };
        setMessage(response.ok ? "Resposta gravada" : payload.error ?? "Falhou");
        if (response.ok) {
          setBody("");
          router.refresh();
        }
      }}
    >
      <textarea className="field min-h-24" value={body} onChange={(event) => setBody(event.target.value)} required />
      <button className="rounded-full bg-ink px-4 py-2 text-sm text-white">Responder</button>
      {message ? <p className="text-sm text-muted">{message}</p> : null}
    </form>
  );
}

export function TxHashForm({ publicCode }: { publicCode: string }) {
  const [hash, setHash] = useState("");
  const [message, setMessage] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const response = await fetch("/api/orders/crypto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicCode, txHash: hash.trim() }),
        });
        const body = (await response.json()) as { error?: string };
        setMessage(response.ok ? "Hash recebido. O despacho começa quando a equipe confirmar o USDT." : body.error ?? "Não gravou");
      }}
    >
      <input className="field" value={hash} onChange={(event) => setHash(event.target.value)} placeholder="Hash da transação" required />
      <button className="rounded-full bg-ink px-4 py-2 text-sm text-white">Enviar hash</button>
      {message ? <p className="text-sm text-muted">{message}</p> : null}
    </form>
  );
}

export function UserControl({ userId, role, note }: { userId: string; role: string; note: string }) {
  const router = useRouter();
  const [nextRole, setNextRole] = useState(role === "OPERATOR" ? "SUPPORT" : role);
  const [text, setText] = useState(note);
  const [message, setMessage] = useState("");

  async function send(payload: Record<string, unknown>) {
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Salvo" : body.error ?? "Falhou");
    if (response.ok) router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select className="field w-auto" value={nextRole} onChange={(event) => setNextRole(event.target.value)}>
          <option value="MASTER">Mestre</option>
          <option value="ADMIN">Administrador</option>
          <option value="SUPPORT">Suporte</option>
          <option value="RESELLER">Revendedor</option>
          <option value="CUSTOMER">Usuário</option>
        </select>
        <button type="button" className="rounded-full bg-ink px-3 py-2 text-sm text-white" onClick={() => send({ action: "role", userId, role: nextRole })}>Trocar cargo</button>
        <button type="button" className="rounded-full border border-line px-3 py-2 text-sm" onClick={() => send({ action: "suspend", userId })}>Suspender</button>
        <button type="button" className="rounded-full border border-line px-3 py-2 text-sm" onClick={() => send({ action: "activate", userId })}>Reativar</button>
      </div>
      <textarea className="field min-h-20" value={text} onChange={(event) => setText(event.target.value)} placeholder="Nota interna" />
      <button type="button" className="rounded-full border border-line px-3 py-2 text-sm" onClick={() => send({ action: "note", userId, note: text })}>Salvar nota</button>
      {message ? <p className="text-sm text-muted">{message}</p> : null}
    </div>
  );
}

export function StaffCreateForm() {
  const [message, setMessage] = useState("");
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const response = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", ...Object.fromEntries(form.entries()) }),
        });
        const body = (await response.json()) as { error?: string };
        setMessage(response.ok ? "Conta criada. A pessoa entra em /entrar." : body.error ?? "Falhou");
      }}
    >
      <input className="field" name="name" placeholder="Nome" required />
      <input className="field" name="email" type="email" placeholder="E-mail" required />
      <input className="field" name="password" type="password" placeholder="Senha" required />
      <select className="field" name="role" defaultValue="SUPPORT">
        <option value="SUPPORT">Suporte</option>
        <option value="ADMIN">Administrador</option>
        <option value="RESELLER">Revendedor</option>
      </select>
      <button className="w-fit rounded-full bg-ink px-4 py-2 text-sm text-white">Criar conta</button>
      {message ? <p className="text-sm text-muted">{message}</p> : null}
    </form>
  );
}
