"use client";

import { useState } from "react";
import { PixPanel } from "@/components/pix-panel";
import { formatBRL } from "@/lib/format";

const amounts = [15000, 30000, 50000, 100000];

type Charge = {
  externalId: string;
  amountCents: number;
  pixCopyPaste: string;
  qrCodeBase64: string;
  status: string;
};

export function DepositDialog({ sandbox }: { sandbox: boolean }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(15000);
  const [charge, setCharge] = useState<Charge | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <>
      <button className="rounded-full bg-copper px-4 py-2.5 text-sm text-white" onClick={() => setOpen(true)}>
        Recarregar via PIX
      </button>
      {open ? (
        <div className="fixed inset-0 z-30 grid place-items-center bg-ink/40 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-3xl bg-card p-5 shadow-card">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-muted">Carteira</p>
                <h2 className="font-display text-3xl">Recarga PIX</h2>
              </div>
              <button className="text-sm text-muted" onClick={() => setOpen(false)}>Fechar</button>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
              {amounts.map((value) => (
                <button
                  key={value}
                  className={`rounded-full px-3 py-1.5 text-sm ${amount === value ? "bg-ink text-paper" : "bg-paper"}`}
                  onClick={() => setAmount(value)}
                >
                  {formatBRL(value)}
                </button>
              ))}
            </div>
            <button
              className="rounded-full bg-pine px-4 py-2 text-sm text-white disabled:opacity-60"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                setError("");
                const response = await fetch("/api/wallet/deposit", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ amountCents: amount }),
                });
                const body = (await response.json()) as Charge & { error?: string };
                setLoading(false);
                if (!response.ok) {
                  setError(body.error ?? "Falha ao gerar PIX");
                  return;
                }
                setCharge(body);
              }}
            >
              {loading ? "Gerando…" : `Gerar PIX de ${formatBRL(amount)}`}
            </button>
            {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
            {charge ? (
              <div className="mt-5">
                <PixPanel
                  amountCents={charge.amountCents}
                  copyPaste={charge.pixCopyPaste}
                  qrCodeBase64={charge.qrCodeBase64}
                  externalId={charge.externalId}
                  status={charge.status}
                  sandbox={sandbox}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
