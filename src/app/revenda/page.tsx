import { Card } from "@/components/ui";

const steps = [
  ["Recarrega", "O PIX entra na carteira e o saldo sobe uma única vez, mesmo se o gateway repetir o aviso."],
  ["Vende", "Você importa o catálogo e lança o pedido do seu cliente. O atacado sai da carteira na hora."],
  ["Despacha", "A fila cria o pedido no fornecedor e paga com o saldo mestre. O rastreio volta para o WhatsApp."],
];

export default function ResellerLanding() {
  return (
    <div className="space-y-8">
      <section className="max-w-3xl space-y-4">
        <p className="text-xs uppercase tracking-[0.18em] text-copper">Conta B2B</p>
        <h1 className="font-display text-5xl leading-[1.05]">Venda o catálogo sem segurar estoque.</h1>
        <p className="text-lg text-ink/80">
          A recarga mínima é R$ 150,00. Cada venda debita o preço de atacado — com a margem da plataforma já dentro — e o galpão envia para o cliente final.
        </p>
        <a href="/cadastro?tipo=revenda" className="inline-flex rounded-full bg-copper px-5 py-3 text-sm text-white">Abrir conta de revenda</a>
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        {steps.map(([title, text]) => (
          <Card key={title}>
            <h2 className="font-display text-2xl">{title}</h2>
            <p className="mt-2 text-sm text-muted">{text}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
