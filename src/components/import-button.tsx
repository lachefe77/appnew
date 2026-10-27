"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ImportButton({ productId, imported }: { productId: string; imported: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <button
      className={`rounded-full px-3 py-1.5 text-sm ${imported ? "bg-paper text-ink" : "bg-pine text-white"} disabled:opacity-60`}
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        await fetch("/api/catalog/import", {
          method: imported ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId }),
        });
        setLoading(false);
        router.refresh();
      }}
    >
      {loading ? "Salvando…" : imported ? "Remover da vitrine" : "Importar em 1 clique"}
    </button>
  );
}
