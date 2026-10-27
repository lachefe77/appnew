import Link from "next/link";
import { LoginForm } from "@/components/auth-form";
import { Card } from "@/components/ui";
import { safeNext } from "@/lib/session";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const demo = process.env.NODE_ENV !== "production";
  return (
    <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-2">
      <Card>
        <h1 className="font-display text-4xl">Entrar</h1>
        <p className="mb-5 mt-2 text-sm text-muted">Revendedor acompanha saldo e pedidos. Admin vê a liquidez do galpão.</p>
        <LoginForm next={safeNext(params.next) ?? undefined} demo={demo} />
        <p className="mt-4 text-sm">
          Sem conta? <Link href="/cadastro" className="text-copper">Cadastre-se</Link>
        </p>
      </Card>
      {demo ? (
        <Card className="bg-ink text-paper">
          <p className="text-xs uppercase tracking-[0.16em] text-gold">Contas locais</p>
          <ul className="mt-4 space-y-3 text-sm">
            <li>Revenda · revenda@novoshorizontes.test · Revenda#Horizonte</li>
            <li>Admin · admin@novoshorizontes.test · Admin#Horizonte</li>
          </ul>
          <p className="mt-4 text-sm text-paper/70">Essas senhas existem só no banco de demonstração.</p>
        </Card>
      ) : null}
    </div>
  );
}
