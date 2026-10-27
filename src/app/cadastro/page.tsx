import Link from "next/link";
import { RegisterForm } from "@/components/auth-form";
import { Card } from "@/components/ui";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const { tipo } = await searchParams;
  const reseller = tipo === "revenda";
  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <h1 className="font-display text-4xl">{reseller ? "Conta de revenda" : "Criar conta"}</h1>
        <p className="mb-5 mt-2 text-sm text-muted">
          {reseller
            ? "A carteira já nasce ativa neste ambiente de teste. A recarga mínima é R$ 150,00."
            : "A vitrine também compra sem conta. A conta serve para acompanhar depois."}
        </p>
        <RegisterForm reseller={reseller} />
        <p className="mt-4 text-sm">
          Já tem conta? <Link href="/entrar" className="text-copper">Entrar</Link>
        </p>
      </Card>
    </div>
  );
}
