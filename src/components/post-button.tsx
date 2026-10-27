"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PostButton({
  url,
  body,
  label,
  confirm,
}: {
  url: string;
  body?: unknown;
  label: string;
  confirm?: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={loading}
        className="rounded-full border border-line bg-card px-3 py-1.5 text-sm disabled:opacity-60"
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setLoading(true);
          setMessage("");
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body ? JSON.stringify(body) : undefined,
          });
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          setLoading(false);
          if (!response.ok) {
            setMessage(payload.error ?? "Falhou");
            return;
          }
          setMessage("Feito");
          router.refresh();
        }}
      >
        {label}
      </button>
      {message ? <span className="text-xs text-muted">{message}</span> : null}
    </span>
  );
}
