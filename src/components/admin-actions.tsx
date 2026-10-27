"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

async function post(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Falha");
}

export function AdminActions({ paused }: { paused: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function run(task: () => Promise<void>) {
    setLoading(true);
    setMessage("");
    try {
      await task();
      router.refresh();
      setMessage("Feito.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falhou");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Action disabled={loading} onClick={() => run(() => post("/api/admin/watchdog"))}>Rodar watchdog</Action>
      <Action disabled={loading} onClick={() => run(() => post("/api/admin/queue", { action: "sweep" }))}>Disparar lembretes de PIX</Action>
      <Action disabled={loading} onClick={() => run(() => post("/api/admin/queue", { action: paused ? "resume" : "pause" }))}>
        {paused ? "Retomar fila" : "Pausar fila"}
      </Action>
      <Action disabled={loading} onClick={() => run(() => post("/api/catalog/sync"))}>Sincronizar catálogo</Action>
      <Action disabled={loading} onClick={() => run(() => post("/api/admin/liquidity", { source: "CJ_BRAZIL", balanceCents: 10000 }))}>
        Simular saldo CJ baixo
      </Action>
      <Action disabled={loading} onClick={() => run(() => post("/api/admin/liquidity", { source: "CJ_BRAZIL", balanceCents: 480000 }))}>
        Repor saldo CJ
      </Action>
      {message ? <span className="self-center text-sm text-muted">{message}</span> : null}
    </div>
  );
}

export function OrderAdminButtons({ publicCode, canTrack }: { publicCode: string; canTrack: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");

  return (
    <div className="flex flex-wrap gap-2">
      {canTrack ? (
        <button
          className="rounded-full bg-pine px-3 py-1.5 text-xs text-white"
          onClick={async () => {
            setError("");
            const response = await fetch("/api/dev/simulate-tracking", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ publicCode }),
            });
            if (!response.ok) {
              const body = (await response.json()) as { error?: string };
              setError(body.error ?? "Falhou");
              return;
            }
            router.refresh();
          }}
        >
          Simular rastreio
        </button>
      ) : null}
      <button
        className="rounded-full border border-line px-3 py-1.5 text-xs"
        onClick={async () => {
          await fetch("/api/admin/orders/requeue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ publicCode }),
          });
          router.refresh();
        }}
      >
        Reprocessar
      </button>
      <button
        className="rounded-full border border-red-200 px-3 py-1.5 text-xs text-red-800"
        onClick={async () => {
          const response = await fetch("/api/admin/orders/refund", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ publicCode }),
          });
          if (!response.ok) {
            const body = (await response.json()) as { error?: string };
            setError(body.error ?? "Não estornou");
            return;
          }
          router.refresh();
        }}
      >
        Estornar
      </button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </div>
  );
}

function Action({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="rounded-full border border-line bg-card px-3 py-2 text-sm disabled:opacity-60" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
