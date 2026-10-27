import bcrypt from "bcryptjs";
import { PrismaClient, type Prisma } from "@prisma/client";
import { ensureFixtures } from "../src/server/catalog";
import { config } from "../src/server/config";
import { sha256 } from "../src/server/crypto";

const prisma = new PrismaClient();

const address = {
  cep: "01310100",
  street: "Avenida Paulista",
  number: "1000",
  complement: "conjunto 101",
  district: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

async function main() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS wallet_balance_nonnegative`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Wallet" ADD CONSTRAINT wallet_balance_nonnegative CHECK ("balanceCents" >= 0)`);

  await ensureFixtures();
  const catalog = await prisma.product.findMany();
  for (const product of catalog) {
    if (product.images.length === 0) {
      await prisma.product.update({
        where: { id: product.id },
        data: { images: [`/catalog/${product.slug}.jpg`] },
      });
    }
  }
  await prisma.product.updateMany({
    where: { slug: "parafusadeira-21v", bundleQty: null },
    data: { bundleQty: 2, bundlePriceCents: 59600 },
  });

  const admin = await upsertUser({
    email: "admin@novoshorizontes.test",
    name: "Master",
    password: "Admin#Horizonte",
    role: "MASTER",
    planStatus: "ACTIVE",
    cpfCnpj: "52998224725",
    phone: "11900000001",
  });
  await upsertUser({
    email: "operador@novoshorizontes.test",
    name: "Suporte da Casa",
    password: "Operador#Horizonte",
    role: "SUPPORT",
    planStatus: "ACTIVE",
    cpfCnpj: "15350946056",
    phone: "11900000002",
  });
  await upsertUser({
    email: "administrador@novoshorizontes.test",
    name: "Administrador da Casa",
    password: "Admin#Horizonte",
    role: "ADMIN",
    planStatus: "ACTIVE",
    cpfCnpj: "11144477735",
    phone: "11900000003",
  });
  const reseller = await upsertUser({
    email: "revenda@novoshorizontes.test",
    name: "Marina Alves",
    password: "Revenda#Horizonte",
    role: "RESELLER",
    planStatus: "ACTIVE",
    cpfCnpj: "39053344705",
    phone: "11988887777",
  });
  if (!reseller.storeSlug || !reseller.affiliateCode) {
    await prisma.user.update({
      where: { id: reseller.id },
      data: {
        storeSlug: reseller.storeSlug ?? "marina",
        affiliateCode: reseller.affiliateCode ?? "MARINA",
      },
    });
  }

  await prisma.setting.upsert({
    where: { key: "cj_master_balance_cents" },
    create: { key: "cj_master_balance_cents", valueJson: { cents: 480000, currency: "BRL" } },
    update: {},
  });
  await prisma.setting.upsert({
    where: { key: "bling_master_balance_cents" },
    create: { key: "bling_master_balance_cents", valueJson: { cents: 320000, currency: "BRL" } },
    update: {},
  });
  await prisma.setting.upsert({
    where: { key: "fulfillment_paused" },
    create: { key: "fulfillment_paused", valueJson: { paused: false, reason: null } },
    update: {},
  });

  const drill = await prisma.product.findUnique({ where: { slug: "parafusadeira-21v" } });
  const gun = await prisma.product.findUnique({ where: { slug: "pistola-massageadora" } });
  const feeder = await prisma.product.findUnique({ where: { slug: "comedouro-wifi" } });
  const fountain = await prisma.product.findUnique({ where: { slug: "bebedouro-inox-gatos" } });
  if (!drill || !gun || !feeder || !fountain || !reseller.wallet) throw new Error("Catálogo de demonstração incompleto");

  for (const product of [drill, gun, feeder, fountain]) {
    await prisma.catalogImport.upsert({
      where: { userId_productId: { userId: reseller.id, productId: product.id } },
      create: { userId: reseller.id, productId: product.id, retailPriceCents: product.suggestedRetailCents },
      update: {},
    });
  }

  const openingKey = "seed:opening:reseller";
  const opening = await prisma.walletLedger.findUnique({ where: { idempotencyKey: openingKey } });
  if (!opening) {
    await prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { id: reseller.wallet!.id },
        data: { balanceCents: { increment: 100_000 }, version: { increment: 1 } },
      });
      await tx.walletLedger.create({
        data: {
          walletId: reseller.wallet!.id,
          amountCents: 100_000,
          type: "ADMIN_ADJUSTMENT",
          idempotencyKey: openingKey,
          description: "Saldo inicial de demonstração",
        },
      });
    });
  }

  await ensureDemoOrder({
    publicCode: "NH-DEMO001",
    clientRequestId: "seed-demo-b2c",
    product: drill,
    channel: "B2C",
    tenantId: null,
    customerName: "Camila Duarte",
    customerPhone: "11977776666",
    paymentStatus: "PENDING",
    fulfillmentStatus: "WAITING_PAYMENT",
    resellerWalletId: null,
  });

  const wholesale = Math.round(gun.supplierCostCents * config.spread);
  await ensureDemoOrder({
    publicCode: "NH-DEMO002",
    clientRequestId: "seed-demo-b2b",
    product: gun,
    channel: "B2B",
    tenantId: reseller.id,
    customerName: "João Ribeiro",
    customerPhone: "11966665555",
    paymentStatus: "PAID",
    fulfillmentStatus: "DISPATCHED_TO_SUPPLIER",
    supplierOrderId: "SBX-CJ_BRAZIL-NH-DEMO002",
    resellerWalletId: reseller.wallet.id,
    debitCents: wholesale,
  });

  console.log("Seed pronto.");
  console.log("Admin:    admin@novoshorizontes.test / Admin#Horizonte");
  console.log("Revenda:  revenda@novoshorizontes.test / Revenda#Horizonte");
  console.log(`PIX de demonstração expira em ${config.pixExpiresMinutes} min.`);
}

async function upsertUser(input: {
  email: string;
  name: string;
  password: string;
  role: "MASTER" | "ADMIN" | "SUPPORT" | "OPERATOR" | "RESELLER" | "CUSTOMER";
  planStatus: "ACTIVE" | "INACTIVE";
  cpfCnpj: string;
  phone: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, 10);
  return prisma.user.upsert({
    where: { email: input.email },
    create: {
      email: input.email,
      name: input.name,
      passwordHash,
      role: input.role,
      planStatus: input.planStatus,
      cpfCnpj: input.cpfCnpj,
      phone: input.phone,
      wallet: { create: { balanceCents: 0 } },
    },
    update: { name: input.name, role: input.role, planStatus: input.planStatus, phone: input.phone, cpfCnpj: input.cpfCnpj },
    include: { wallet: true },
  });
}

async function ensureDemoOrder(input: {
  publicCode: string;
  clientRequestId: string;
  product: { id: string; title: string; supplierSource: "CJ_BRAZIL" | "BLING_HUB"; supplierCostCents: number; platformWholesaleCents: number; suggestedRetailCents: number };
  channel: "B2C" | "B2B";
  tenantId: string | null;
  customerName: string;
  customerPhone: string;
  paymentStatus: "PENDING" | "PAID";
  fulfillmentStatus: "WAITING_PAYMENT" | "DISPATCHED_TO_SUPPLIER";
  supplierOrderId?: string;
  resellerWalletId: string | null;
  debitCents?: number;
}) {
  const existing = await prisma.order.findUnique({ where: { publicCode: input.publicCode } });
  if (existing) return;

  const sale = input.product.suggestedRetailCents;
  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: input.product.id },
      data: { stockQuantity: { decrement: 1 } },
    });
    const order = await tx.order.create({
      data: {
        publicCode: input.publicCode,
        clientRequestId: input.clientRequestId,
        tenantId: input.tenantId,
        channel: input.channel,
        customerName: input.customerName,
        customerCpf: "52998224725",
        customerPhone: input.customerPhone,
        customerEmail: "cliente.demo@novoshorizontes.test",
        shippingAddressJson: address,
        totalCostCents: input.product.supplierCostCents,
        totalWholesaleCents: input.product.platformWholesaleCents,
        totalSaleCents: sale,
        paymentStatus: input.paymentStatus,
        fulfillmentStatus: input.fulfillmentStatus,
        supplierSource: input.product.supplierSource,
        supplierOrderId: input.supplierOrderId,
        items: {
          create: {
            productId: input.product.id,
            title: input.product.title,
            quantity: 1,
            unitCostCents: input.product.supplierCostCents,
            unitWholesaleCents: input.product.platformWholesaleCents,
            unitSaleCents: sale,
          },
        },
      },
    });

    if (input.paymentStatus === "PENDING") {
      const externalId = `sandbox_${input.publicCode.toLowerCase()}`;
      const pix = `SANDBOX-PIX|NOVOS-HORIZONTES|${externalId}|${sale}`;
      const qr = await import("qrcode").then((mod) =>
        mod.default.toDataURL(pix, { margin: 1, width: 320, color: { dark: "#1a1714", light: "#fffaf3" } }),
      );
      await tx.order.update({ where: { id: order.id }, data: { pixCopyPaste: pix, pixQrCodeBase64: qr } });
      const charge = await tx.pixCharge.create({
        data: {
          purpose: "ORDER_PAYMENT",
          orderId: order.id,
          provider: "sandbox",
          externalId,
          amountCents: BigInt(sale),
          pixCopyPaste: pix,
          expiresAt: new Date(Date.now() + config.pixExpiresMinutes * 60_000),
        },
      });
      await tx.outboxJob.create({
        data: {
          queue: "abandoned-pix-queue",
          jobKey: `recover:${charge.id}`,
          payloadJson: { chargeId: charge.id } as Prisma.InputJsonValue,
          runAt: new Date(Date.now() + config.abandonedPixDelayMs),
        },
      });
    }

    if (input.resellerWalletId && input.debitCents) {
      await tx.wallet.update({
        where: { id: input.resellerWalletId },
        data: { balanceCents: { increment: BigInt(-input.debitCents) }, version: { increment: 1 } },
      });
      await tx.walletLedger.create({
        data: {
          walletId: input.resellerWalletId,
          orderId: order.id,
          amountCents: BigInt(-input.debitCents),
          type: "ORDER_DEBIT",
          idempotencyKey: sha256(`${input.tenantId}:${order.id}:ORDER_DEBIT`),
          description: `Atacado do pedido ${input.publicCode}`,
        },
      });
      const master = await tx.setting.findUnique({ where: { key: "cj_master_balance_cents" } });
      const current = (master?.valueJson as { cents?: number; currency?: string } | null)?.cents ?? 0;
      await tx.setting.update({
        where: { key: "cj_master_balance_cents" },
        data: { valueJson: { cents: current - input.product.supplierCostCents, currency: "BRL" } },
      });
    }
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
