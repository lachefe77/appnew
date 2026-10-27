import { SettingsForm } from "@/components/settings-form";
import { requireUser } from "@/server/auth";
import { getCommerce } from "@/server/commerce";

export default async function SettingsPage() {
  const user = await requireUser(["ADMIN", "OPERATOR"]);
  const commerce = await getCommerce();
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Ajustes da operação</h1>
      <p className="max-w-2xl text-sm text-muted">
        Estes números mudam preço, recarga, lembrete e alerta. Asaas, OpenPix, CJ, Bling, Evolution e Telegram continuam nas variáveis de ambiente. Com a chave preenchida e o modo live, o mesmo código chama o fornecedor.
      </p>
      {user.role === "ADMIN" ? <SettingsForm initial={commerce} /> : <p className="text-sm text-muted">O operador consulta. Só o dono grava.</p>}
    </div>
  );
}
