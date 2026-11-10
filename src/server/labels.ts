export const ORDER_STATUSES = ["pendente", "pago", "cancelado", "reembolsado"] as const

export const orderStatusLabel: Record<(typeof ORDER_STATUSES)[number], string> = {
  pendente: "Pendente",
  pago: "Pago",
  cancelado: "Cancelado",
  reembolsado: "Reembolsado",
}

export const grantStatusLabel = {
  ativo: "Ativo",
  congelado: "Congelado",
  removido: "Removido",
  expirado: "Expirado",
} as const

export const panelReasonLabel = {
  sem_plano: "Sem plano ativo",
  congelado: "Plano congelado",
  removido: "Plano removido",
  expirado: "Plano vencido",
  painel_desligado: "Painel desligado",
  banido: "Conta suspensa",
  manutencao: "Casa em manutenção",
} as const

export const audienceLabel = {
  todos: "Todo o site",
  clientes: "Início e planos",
  painel: "Painel",
} as const

export function isOrderStatus(value: string): value is (typeof ORDER_STATUSES)[number] {
  return (ORDER_STATUSES as readonly string[]).includes(value)
}
