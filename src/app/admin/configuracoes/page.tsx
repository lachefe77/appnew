import { BrandForm } from "@/components/brand-form";
import { SettingsForm } from "@/components/settings-form";
import { requireUser } from "@/server/auth";
import { getBrand } from "@/server/brand";
import { getCommerce } from "@/server/commerce";

export default async function SettingsPage() {
  const user = await requireUser(["MASTER", "ADMIN", "SUPPORT", "OPERATOR"]);
  const [commerce, brand] = await Promise.all([getCommerce(), getBrand()]);
  const desk = user.role === "MASTER" || user.role === "ADMIN";
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Ajustes da casa</h1>
        <p className="max-w-2xl text-sm text-muted">
          O texto da vitrine, o endereço USDT e a comissão mudam aqui. Asaas, OpenPix, CJ, Bling, Evolution e Telegram continuam nas variáveis de ambiente.
        </p>
        {desk ? <BrandForm initial={brand} /> : <p className="text-sm text-muted">O suporte consulta. Master e administrador gravam.</p>}
      </div>
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Preço e alertas</h2>
        {desk ? <SettingsForm initial={commerce} /> : null}
      </div>
    </div>
  );
}
