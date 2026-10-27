"use client";

import { useState } from "react";

export function CopyBox({ text, label = "Copiar mensagem" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="space-y-2">
      <p className="whitespace-pre-wrap text-sm text-muted">{text}</p>
      <button
        type="button"
        className="rounded-full border border-line px-3 py-1.5 text-sm"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setDone(true);
        }}
      >
        {done ? "Copiado" : label}
      </button>
    </div>
  );
}
