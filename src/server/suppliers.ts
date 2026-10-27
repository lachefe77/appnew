import { SupplierSource } from "@prisma/client";
import { cacheGet, cacheSet } from "./cache";
import { config, isSandboxSupplier } from "./config";
import { prisma } from "./db";
import { SupplierError, errorMessage } from "./errors";
import { fetchJson, HttpError } from "./http";
import { getMasterBalance, setMasterBalance, type BalanceSetting } from "./settings";
import type { AddressInput } from "./validators";

export type SupplierOrderInput = {
  publicCode: string;
  customerName: string;
  customerCpf: string;
  customerPhone: string;
  customerEmail?: string | null;
  address: AddressInput;
  items: Array<{ sku: string; title: string; quantity: number; unitCostCents: number }>;
  costCents: number;
};

export type SupplierCatalogItem = {
  supplierSource: SupplierSource;
  supplierSku: string;
  title: string;
  description: string;
  category: string;
  supplierCostCents: number;
  stockQuantity: number;
  images: string[];
  weightGrams: number;
};

export interface SupplierAdapter {
  source: SupplierSource;
  syncCatalog(): Promise<SupplierCatalogItem[]>;
  createOrder(input: SupplierOrderInput): Promise<{ supplierOrderId: string }>;
  payOrder(supplierOrderId: string, costCents: number): Promise<void>;
  getMasterBalance(): Promise<BalanceSetting>;
}

export function adapterFor(source: SupplierSource): SupplierAdapter {
  if (isSandboxSupplier()) return new SandboxAdapter(source);
  if (source === "CJ_BRAZIL") return new CjAdapter();
  return new BlingAdapter();
}

class SandboxAdapter implements SupplierAdapter {
  constructor(readonly source: SupplierSource) {}

  async syncCatalog() {
    const { FIXTURES } = await import("./fixtures");
    return FIXTURES.filter((item) => item.supplierSource === this.source).map((item) => ({
      supplierSource: item.supplierSource,
      supplierSku: item.supplierSku,
      title: item.title,
      description: item.description,
      category: item.category,
      supplierCostCents: item.supplierCostCents,
      stockQuantity: item.stockQuantity,
      images: [],
      weightGrams: item.weightGrams,
    }));
  }

  async createOrder(input: SupplierOrderInput) {
    return { supplierOrderId: `SBX-${this.source}-${input.publicCode}` };
  }

  async payOrder(_supplierOrderId: string, costCents: number) {
    const current = await getMasterBalance(this.source);
    if (current.cents < costCents) {
      throw new SupplierError(
        "INSUFFICIENT_MASTER_BALANCE",
        `Saldo mestre ${this.source} insuficiente para pagar ${costCents} centavos`,
      );
    }
    await setMasterBalance(this.source, { cents: current.cents - costCents, currency: current.currency });
  }

  async getMasterBalance() {
    return getMasterBalance(this.source);
  }
}

type CjEnvelope<T> = { code?: number; result?: boolean; message?: string; data?: T };

class CjAdapter implements SupplierAdapter {
  readonly source = SupplierSource.CJ_BRAZIL;

  async syncCatalog() {
    const data = await this.request<unknown>("/product/listV2?pageNum=1&pageSize=50&countryCode=BR");
    const list = extractList(data);
    return list.map((row) => {
      const sku = String(row.productSku ?? row.sku ?? row.pid ?? "");
      const usd = Number(row.sellPrice ?? row.productWeightPrice ?? 0);
      const stock = Number(row.warehouseInventoryNum ?? row.inventory ?? row.stock ?? 0);
      return {
        supplierSource: SupplierSource.CJ_BRAZIL,
        supplierSku: sku,
        title: String(row.productNameEn ?? row.productName ?? sku),
        description: String(row.description ?? row.productNameEn ?? "Produto sincronizado da CJ."),
        category: "ferramentas",
        supplierCostCents: Math.round(usd * config.usdBrlRate * 100),
        stockQuantity: Number.isFinite(stock) ? stock : 0,
        images: row.productImage ? [String(row.productImage)] : [],
        weightGrams: Math.round(Number(row.productWeight ?? 500)),
      };
    }).filter((item) => item.supplierSku);
  }

  async createOrder(input: SupplierOrderInput) {
    if (!config.cjLogisticName) {
      throw new SupplierError("CJ_CONFIG", "Defina CJ_LOGISTIC_NAME com uma logística válida da conta CJ");
    }
    const data = await this.request<string>("/shopping/order/createOrderV2", {
      method: "POST",
      body: JSON.stringify({
        orderNumber: input.publicCode,
        shippingZip: input.address.cep,
        shippingCountryCode: "BR",
        shippingCountry: "Brazil",
        shippingProvince: input.address.state,
        shippingCity: input.address.city,
        shippingCounty: input.address.district,
        shippingPhone: input.customerPhone,
        shippingCustomerName: input.customerName,
        shippingAddress: `${input.address.street}, ${input.address.number}`,
        shippingAddress2: input.address.complement,
        houseNumber: input.address.number,
        taxId: input.customerCpf,
        email: input.customerEmail ?? "",
        remark: `Novos Horizontes ${input.publicCode}`,
        payType: 3,
        logisticName: config.cjLogisticName,
        fromCountryCode: config.cjFromCountry,
        platform: "api",
        products: input.items.map((item) => ({ sku: item.sku, quantity: item.quantity })),
      }),
    });
    const supplierOrderId = typeof data === "string" ? data : String((data as { orderId?: string })?.orderId ?? "");
    if (!supplierOrderId) throw new SupplierError("CJ_ORDER", "A CJ não devolveu o id do pedido");
    return { supplierOrderId };
  }

  async payOrder(supplierOrderId: string) {
    await this.request<unknown>("/shopping/pay/payBalance", {
      method: "POST",
      body: JSON.stringify({ orderId: supplierOrderId }),
    });
  }

  async getMasterBalance(): Promise<BalanceSetting> {
    const data = await this.request<{ amount?: number }>("/shopping/pay/getBalance");
    const cents = Math.round(Number(data?.amount ?? 0) * 100);
    const value = { cents, currency: "USD" as const };
    await setMasterBalance(this.source, value);
    return value;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.token();
    try {
      const body = (await fetchJson(`${config.cjApiUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          "CJ-Access-Token": token,
          ...(init?.headers ?? {}),
        },
      })) as CjEnvelope<T>;
      if (body.result === false || (body.code && body.code !== 200)) {
        const message = body.message ?? "Erro na CJ";
        if (/balance|saldo|insufficient|not enough|fund/i.test(message)) {
          throw new SupplierError("INSUFFICIENT_MASTER_BALANCE", message);
        }
        throw new SupplierError("CJ_ERROR", message);
      }
      return body.data as T;
    } catch (error) {
      if (error instanceof SupplierError) throw error;
      if (error instanceof HttpError) {
        const message = errorMessage(error);
        throw new SupplierError("CJ_HTTP", message);
      }
      throw error;
    }
  }

  private async token() {
    const cached = await cacheGet("cj:access-token");
    if (cached) return cached;
    if (!config.cjApiKey) throw new SupplierError("CJ_CONFIG", "CJ_API_KEY ausente");
    const body = (await fetchJson(`${config.cjApiUrl}/authentication/getAccessToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: config.cjApiKey }),
    })) as CjEnvelope<{ accessToken?: string }>;
    const accessToken = body.data?.accessToken;
    if (!accessToken) throw new SupplierError("CJ_AUTH", body.message ?? "Token CJ ausente");
    await cacheSet("cj:access-token", accessToken, 60 * 60 * 12);
    return accessToken;
  }
}

type BlingToken = { access_token?: string; refresh_token?: string; expires_in?: number };
type BlingList<T> = { data?: T[] };
type BlingId = { data?: { id?: number } };

class BlingAdapter implements SupplierAdapter {
  readonly source = SupplierSource.BLING_HUB;

  async syncCatalog() {
    const rows = await this.request<BlingList<Record<string, unknown>>>("/produtos?pagina=1&limite=100");
    return (rows.data ?? []).map((row) => {
      const price = Number(row.preco ?? 0);
      const stockNode = row.estoque as { saldoVirtualTotal?: number } | undefined;
      const stock = Number(stockNode?.saldoVirtualTotal ?? 0);
      const sku = String(row.codigo ?? row.id ?? "");
      return {
        supplierSource: SupplierSource.BLING_HUB,
        supplierSku: sku,
        title: String(row.nome ?? sku),
        description: String(row.descricaoCurta ?? row.nome ?? "Produto sincronizado do Bling."),
        category: "ferramentas",
        supplierCostCents: Math.round(price * 100),
        stockQuantity: Number.isFinite(stock) ? stock : 0,
        images: [],
        weightGrams: Math.round(Number(row.pesoBruto ?? 0.5) * 1000),
      };
    }).filter((item) => item.supplierSku);
  }

  async createOrder(input: SupplierOrderInput) {
    const contact = await this.request<BlingId>("/contatos", {
      method: "POST",
      body: JSON.stringify({
        nome: input.customerName,
        situacao: "A",
        numeroDocumento: input.customerCpf,
        tipo: "F",
        celular: input.customerPhone,
        email: input.customerEmail || undefined,
        endereco: {
          geral: {
            endereco: input.address.street,
            numero: input.address.number,
            complemento: input.address.complement,
            bairro: input.address.district,
            cep: input.address.cep,
            municipio: input.address.city,
            uf: input.address.state,
          },
        },
      }),
    });
    const contactId = contact.data?.id;
    if (!contactId) throw new SupplierError("BLING_CONTACT", "O Bling não devolveu o contato");
    const today = new Date().toISOString().slice(0, 10);
    const order = await this.request<BlingId>("/pedidos/vendas", {
      method: "POST",
      body: JSON.stringify({
        data: today,
        dataSaida: today,
        contato: { id: contactId },
        observacoes: `Novos Horizontes ${input.publicCode}. Expedir para o cliente final.`,
        observacoesInternas: "Pago com saldo da operação. Não gerar cobrança para o cliente.",
        itens: input.items.map((item) => ({
          codigo: item.sku,
          descricao: item.title,
          unidade: "UN",
          quantidade: item.quantity,
          valor: Number((item.unitCostCents / 100).toFixed(2)),
        })),
        transporte: {
          fretePorConta: 0,
          quantidadeVolumes: 1,
          etiqueta: {
            nome: input.customerName,
            endereco: input.address.street,
            numero: input.address.number,
            complemento: input.address.complement,
            municipio: input.address.city,
            uf: input.address.state,
            cep: input.address.cep,
            bairro: input.address.district,
            nomePais: "BRASIL",
          },
        },
      }),
    });
    const supplierOrderId = order.data?.id ? String(order.data.id) : "";
    if (!supplierOrderId) throw new SupplierError("BLING_ORDER", "O Bling não devolveu o pedido");
    return { supplierOrderId };
  }

  async payOrder(supplierOrderId: string, costCents: number) {
    const current = await getMasterBalance(this.source);
    if (current.cents < costCents) {
      throw new SupplierError("INSUFFICIENT_MASTER_BALANCE", "Saldo pré-pago do galpão nacional insuficiente");
    }
    await setMasterBalance(this.source, { cents: current.cents - costCents, currency: "BRL" });
    await prisma.notificationLog.create({
      data: {
        channel: "bling",
        target: supplierOrderId,
        body: `Pedido ${supplierOrderId} lançado no Bling e abatido do saldo mestre interno.`,
        status: "SENT",
      },
    });
  }

  async getMasterBalance() {
    return getMasterBalance(this.source);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.token();
    try {
      return (await fetchJson(`${config.blingApiUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      })) as T;
    } catch (error) {
      if (error instanceof HttpError) throw new SupplierError("BLING_HTTP", errorMessage(error));
      throw error;
    }
  }

  private async token() {
    const cached = await cacheGet("bling:access-token");
    if (cached) return cached;
    const refresh = await this.refreshToken();
    if (!config.blingClientId || !config.blingClientSecret || !refresh) {
      throw new SupplierError("BLING_CONFIG", "Credenciais OAuth do Bling ausentes");
    }
    const basic = Buffer.from(`${config.blingClientId}:${config.blingClientSecret}`).toString("base64");
    const body = (await fetchJson("https://www.bling.com.br/Api/v3/oauth/token", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
    })) as BlingToken;
    if (!body.access_token) throw new SupplierError("BLING_AUTH", "O Bling não renovou o access token");
    await cacheSet("bling:access-token", body.access_token, Math.max(60, (body.expires_in ?? 3600) - 120));
    if (body.refresh_token) {
      await prisma.setting.upsert({
        where: { key: "bling_refresh_token" },
        create: { key: "bling_refresh_token", valueJson: { token: body.refresh_token } },
        update: { valueJson: { token: body.refresh_token } },
      });
    }
    return body.access_token;
  }

  private async refreshToken() {
    const row = await prisma.setting.findUnique({ where: { key: "bling_refresh_token" } });
    const saved = (row?.valueJson as { token?: string } | null)?.token;
    return saved || config.blingRefreshToken;
  }
}

function extractList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    for (const key of ["list", "content", "records"]) {
      if (Array.isArray(record[key])) return record[key] as Record<string, unknown>[];
    }
  }
  return [];
}

export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}
