import { AdminHeading, EmptyNote } from "@/components/admin-ui"

export const dynamic = "force-dynamic"

export default function PaymentsPage() {
  return (
    <>
      <AdminHeading title="Pagamentos" lede="Pix, cripto e a fonte das odds ficam fora deste recorte." />
      <EmptyNote>
        Nenhuma cobrança nesta versão. Quando o pagamento entrar, a chave e a carteira serão configuradas nesta tela.
      </EmptyNote>
    </>
  )
}
