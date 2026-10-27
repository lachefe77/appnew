export function formatBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatMoney(cents: number, currency: "BRL" | "USD") {
  return (cents / 100).toLocaleString(currency === "BRL" ? "pt-BR" : "en-US", {
    style: "currency",
    currency,
  });
}

export function paymentLabel(status: string) {
  const labels: Record<string, string> = {
    PENDING: "Aguardando PIX",
    PAID: "Pago",
    EXPIRED: "Expirado",
    REFUNDED: "Estornado",
  };
  return labels[status] ?? status;
}

export function fulfillmentLabel(status: string) {
  const labels: Record<string, string> = {
    WAITING_PAYMENT: "Aguardando pagamento",
    QUEUED: "Na fila do galpão",
    DISPATCHED_TO_SUPPLIER: "No fornecedor",
    SHIPPED: "Enviado",
    DELIVERED: "Entregue",
    FAILED: "Falhou",
  };
  return labels[status] ?? status;
}

export function sourceLabel(source: string) {
  if (source === "CJ_BRAZIL") return "Armazém CJ · BR";
  if (source === "BLING_HUB") return "Galpão nacional";
  return source;
}

export function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    ferramentas: "Ferramentas",
    "bem-estar": "Bem-estar",
    pet: "Pet",
  };
  return labels[category] ?? category;
}

export function ledgerLabel(type: string) {
  const labels: Record<string, string> = {
    PIX_DEPOSIT: "Recarga PIX",
    ORDER_DEBIT: "Débito de pedido",
    REFUND: "Estorno",
    ADMIN_ADJUSTMENT: "Ajuste",
    AFFILIATE_COMMISSION: "Comissão de afiliado",
  };
  return labels[type] ?? type;
}

export function trackingMessage(order: { customerName: string; publicCode: string; trackingCode: string | null }) {
  return [
    `Olá, ${order.customerName}. Aqui é o Mestre do Atacadão.`,
    `O pedido ${order.publicCode} foi enviado.`,
    `Código de rastreio: ${order.trackingCode ?? "ainda sem código"}.`,
  ].join("\n");
}

export function whatsAppNumber(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  return `55${digits}`;
}
