import { prisma } from "./db";

export type FraudFlag = {
  id: string;
  level: "alto" | "médio";
  title: string;
  detail: string;
  href?: string;
};

export async function fraudFlags(): Promise<FraudFlag[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [events, orders, expired] = await Promise.all([
    prisma.loginEvent.findMany({
      where: { createdAt: { gte: since }, ip: { not: "desconhecido" } },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.order.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true,
        publicCode: true,
        customerName: true,
        customerCpf: true,
        customerPhone: true,
        totalSaleCents: true,
        paymentStatus: true,
        payMethod: true,
        cryptoTxHash: true,
        createdAt: true,
        tenantId: true,
      },
    }),
    prisma.pixCharge.count({ where: { status: "EXPIRED", createdAt: { gte: since } } }),
  ]);

  const flags: FraudFlag[] = [];
  const byIp = new Map<string, Map<string, string>>();
  for (const event of events) {
    if (event.ip.startsWith("127.") || event.ip === "::1") continue;
    const names = byIp.get(event.ip) ?? new Map<string, string>();
    names.set(event.userId, event.user.name);
    byIp.set(event.ip, names);
  }
  for (const [ip, names] of byIp) {
    if (names.size < 2) continue;
    flags.push({
      id: `ip-${ip}`,
      level: "alto",
      title: "Várias contas no mesmo IP",
      detail: `${ip} entrou em ${names.size} contas: ${[...names.values()].join(", ")}.`,
    });
  }

  const byCpf = new Map<string, Set<string>>();
  const byPhone = new Map<string, Set<string>>();
  for (const order of orders) {
    const names = byCpf.get(order.customerCpf) ?? new Set<string>();
    names.add(order.customerName);
    byCpf.set(order.customerCpf, names);
    const phones = byPhone.get(order.customerPhone) ?? new Set<string>();
    phones.add(order.customerName);
    byPhone.set(order.customerPhone, phones);
    if (order.totalSaleCents >= 150_000 && order.paymentStatus === "PENDING") {
      flags.push({
        id: `high-${order.id}`,
        level: "alto",
        title: "Pedido alto ainda sem pagamento",
        detail: `${order.publicCode} está em ${order.payMethod} por acima de R$ 1.500 e ainda não confirmou.`,
        href: `/admin/pedidos/${order.publicCode}`,
      });
    }
    if (order.payMethod === "USDT" && order.paymentStatus === "PENDING" && order.cryptoTxHash) {
      flags.push({
        id: `usdt-${order.id}`,
        level: "médio",
        title: "USDT com hash à espera de conferência",
        detail: `${order.publicCode} informou hash e o despacho ainda não foi liberado.`,
        href: `/admin/pedidos/${order.publicCode}`,
      });
    }
  }
  for (const [cpf, names] of byCpf) {
    if (names.size < 2) continue;
    flags.push({
      id: `cpf-${cpf}`,
      level: "alto",
      title: "Mesmo CPF com nomes diferentes",
      detail: `CPF ${cpf} apareceu como ${[...names].join(" e ")}.`,
    });
  }
  for (const [phone, names] of byPhone) {
    if (names.size < 3) continue;
    flags.push({
      id: `phone-${phone}`,
      level: "médio",
      title: "Mesmo WhatsApp em vários nomes",
      detail: `${phone} saiu em pedidos de ${[...names].join(", ")}.`,
    });
  }
  if (expired >= 8) {
    flags.push({
      id: "expired",
      level: "médio",
      title: "Muitos pagamentos vencidos na semana",
      detail: `${expired} cobranças expiraram em 7 dias. Vale olhar se é abandono ou teste de conta.`,
    });
  }
  return flags;
}
