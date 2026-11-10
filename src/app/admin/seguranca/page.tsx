import { redirect } from "next/navigation"
import { AdminHeading } from "@/components/admin-ui"
import { prisma } from "@/lib/db"
import { requireAdmin } from "@/lib/session"
import { generateTotpSecret, verifyTotp } from "@/server/totp"

export const dynamic = "force-dynamic"

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const admin = await requireAdmin()
  const query = await searchParams
  return (
    <>
      <AdminHeading title="Segurança" lede="O segundo fator vale só para a conta de administração. O cliente entra com e-mail e senha." />
      {query.erro ? <p className="mb-3 text-sm text-[#8d2b2b]">{query.erro}</p> : null}
      {query.ok ? <p className="mb-3 text-sm text-[#0c7a45]">{query.ok}</p> : null}
      <p className="mb-4 text-sm">{admin.totpEnabled ? "Segundo fator ligado." : "Segundo fator desligado."}</p>
      {admin.totpSecret && !admin.totpEnabled ? (
        <p className="panel mb-4 text-sm">
          Segredo para o aplicativo: <strong>{admin.totpSecret}</strong>
        </p>
      ) : null}
      <form action={startTotp} className="panel mb-3">
        <button className="btn-admin" type="submit">
          Gerar segredo
        </button>
      </form>
      <form action={confirmTotp} className="panel flex items-end gap-2">
        <label>
          <span className="label-light">Código atual</span>
          <input className="field-light" name="code" required />
        </label>
        <button className="btn-admin" type="submit">
          Ligar
        </button>
      </form>
    </>
  )
}

async function startTotp() {
  "use server"
  const admin = await requireAdmin()
  await prisma.user.update({
    where: { id: admin.id },
    data: { totpSecret: generateTotpSecret(), totpEnabled: false },
  })
  redirect("/admin/seguranca")
}

async function confirmTotp(formData: FormData) {
  "use server"
  const admin = await requireAdmin()
  if (!admin.totpSecret || !verifyTotp(admin.totpSecret, String(formData.get("code") ?? ""))) {
    redirect("/admin/seguranca?erro=Código%20inválido.")
  }
  await prisma.user.update({ where: { id: admin.id }, data: { totpEnabled: true } })
  redirect("/admin/seguranca?ok=Segundo%20fator%20ligado.")
}
