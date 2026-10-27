"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBRL } from "@/lib/format";

export function PixPanel({
  amountCents,
  copyPaste,
  qrCodeBase64,
  externalId,
  sandbox,
  status,
}: {
  amountCents: number;
  copyPaste: string;
  qrCodeBase64: string;
  externalId: string;
  sandbox: boolean;
  status: string;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [paid, setPaid] = useState(status === "PAID");

  if (paid) return <p className="text-sm text-pine">Pagamento confirmado. O saldo ou o pedido atualiza em seguida.</p>;

  return (
    <div className="grid gap-4 sm:grid-cols-[200px_1fr] sm:items-center">
      <img src={qrCodeBase64} alt="QR Code do PIX de teste" className="w-full rounded-2xl border border-line bg-white" />
      <div className="space-y-3">
        <p className="font-display text-3xl">{formatBRL(amountCents)}</p>
        <p className="break-all rounded-2xl bg-paper px-3 py-2 text-xs leading-relaxed text-ink/80">{copyPaste}</p>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full border border-line bg-card px-4 py-2 text-sm"
            onClick={async () => {
              await navigator.clipboard.writeText(copyPaste);
              setCopied(true);
            }}
          >
            {copied ? "Copiado" : "Copiar código"}
          </button>
          {sandbox ? (
            <button
              className="rounded-full bg-pine px-4 py-2 text-sm text-white disabled:opacity-60"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                setError("");
                const response = await fetch("/api/dev/simulate-payment", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ externalId }),
                });
                const body = (await response.json()) as { error?: string };
                setLoading(false);
                if (!response.ok) {
                  setError(body.error ?? "Não foi possível simular");
                  return;
                }
                setPaid(true);
                router.refresh();
              }}
            >
              {loading ? "Confirmando…" : "Simular pagamento"}
            </button>
          ) : null}
        </div>
        {sandbox ? (
          <p className="text-sm text-muted">Ambiente de teste: este código não movimenta dinheiro real.</p>
        ) : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </div>
    </div>
  );
}
