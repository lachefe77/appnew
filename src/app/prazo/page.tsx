export default function ShippingPolicyPage() {
  return (
    <article className="max-w-2xl space-y-4">
      <h1 className="text-3xl font-semibold">Prazo, troca e origem do envio</h1>
      <p>Os produtos saem de estoque no Brasil: armazém CJ ou galpão nacional ligado ao Bling. O prazo mostrado no card conta em dias úteis depois que o PIX confirma.</p>
      <p>O pedido reserva o estoque enquanto o PIX está aberto. Se o PIX vence, o estoque volta. O código de rastreio aparece na página do pedido quando o fornecedor atualiza o envio.</p>
      <p>Troca e devolução seguem o CDC: produto com defeito ou diferente do anúncio pode ser recusado na entrega. O estorno do PIX no banco é feito no gateway depois que a operação marca o pedido como estornado.</p>
      <p>O CPF do comprador vai na nota e no pedido do fornecedor. Sem ele o despacho não sai.</p>
    </article>
  );
}
