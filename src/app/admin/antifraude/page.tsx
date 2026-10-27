import Link from "next/link";
import { requireUser } from "@/server/auth";
import { fraudFlags } from "@/server/fraud";

export default async function FraudPage() {
  await requireUser(["MASTER", "ADMIN", "SUPPORT", "OPERATOR"]);
  const flags = await fraudFlags();
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Antifraude</h1>
      <p className="max-w-2xl text-sm text-muted">
        A casa não recebe cartão. O que esta aba olha é conta repetida, CPF com nomes diferentes, pedido alto sem pagamento e USDT com hash ainda não conferido. Cartão clonado não passa por aqui porque o checkout não oferece cartão.
      </p>
      <ul className="space-y-3">
        {flags.map((flag) => (
          <li key={flag.id} className="rounded-2xl border border-line bg-card p-4 text-sm">
            <p className="text-xs uppercase tracking-[0.14em] text-muted">{flag.level}</p>
            <p className="mt-1 font-medium">{flag.title}</p>
            <p className="mt-1 text-muted">{flag.detail}</p>
            {flag.href ? <Link className="mt-2 inline-block text-pine" href={flag.href}>Abrir pedido</Link> : null}
          </li>
        ))}
      </ul>
      {flags.length === 0 ? <p className="text-sm text-muted">Nenhum sinal nos últimos 7 dias.</p> : null}
    </div>
  );
}
