import { AdminHeading, EmptyNote } from "@/components/admin-ui"

export const dynamic = "force-dynamic"

export default function SupportPage() {
  return (
    <>
      <AdminHeading title="Suporte" lede="Sugestões e bugs ainda não têm fila." />
      <EmptyNote>O botão de sugestão do painel chega junto com a grade de sinais. A fila fica vazia de propósito.</EmptyNote>
    </>
  )
}
