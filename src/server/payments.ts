import QRCode from "qrcode";
import { config, isSandboxPayment } from "./config";
import { newId } from "./crypto";
import { AppError } from "./errors";
import { fetchJson, HttpError } from "./http";

export type PixRequest = {
  amountCents: number;
  description: string;
  externalReference: string;
  customer: {
    name: string;
    cpfCnpj?: string | null;
    email?: string | null;
    phone?: string | null;
  };
};

export type PixIssued = {
  provider: string;
  externalId: string;
  pixCopyPaste: string;
  qrCodeBase64: string;
  expiresAt: Date;
};

export async function issuePix(input: PixRequest): Promise<PixIssued> {
  if (input.amountCents <= 0) throw new AppError("Valor inválido", "BAD_AMOUNT");
  if (config.paymentProvider === "asaas") return issueAsaas(input);
  if (config.paymentProvider === "openpix") return issueOpenPix(input);
  return issueSandbox(input);
}

async function toQr(payload: string) {
  return QRCode.toDataURL(payload, {
    margin: 1,
    width: 320,
    errorCorrectionLevel: "M",
    color: { dark: "#1a1714", light: "#fffaf3" },
  });
}

async function issueSandbox(input: PixRequest): Promise<PixIssued> {
  const externalId = newId("sandbox");
  const pixCopyPaste = `SANDBOX-PIX|NOVOS-HORIZONTES|${externalId}|${input.amountCents}`;
  return {
    provider: "sandbox",
    externalId,
    pixCopyPaste,
    qrCodeBase64: await toQr(pixCopyPaste),
    expiresAt: new Date(Date.now() + config.pixExpiresMinutes * 60_000),
  };
}

function reais(cents: number) {
  return Number((cents / 100).toFixed(2));
}

async function issueAsaas(input: PixRequest): Promise<PixIssued> {
  if (!config.asaasApiKey) throw new AppError("ASAAS_API_KEY ausente", "PAYMENT_NOT_CONFIGURED", 503);
  const customerId = await asaasCustomer(input.customer);
  const due = new Date();
  const dueDate = due.toISOString().slice(0, 10);
  const payment = await asaas<AsaasPayment>("/payments", {
    method: "POST",
    body: JSON.stringify({
      customer: customerId,
      billingType: "PIX",
      value: reais(input.amountCents),
      dueDate,
      description: input.description.slice(0, 500),
      externalReference: input.externalReference,
    }),
  });
  const qr = await asaas<AsaasQr>(`/payments/${payment.id}/pixQrCode`);
  const encoded = qr.encodedImage.startsWith("data:") ? qr.encodedImage : `data:image/png;base64,${qr.encodedImage}`;
  return {
    provider: "asaas",
    externalId: payment.id,
    pixCopyPaste: qr.payload,
    qrCodeBase64: encoded,
    expiresAt: qr.expirationDate ? new Date(qr.expirationDate) : new Date(Date.now() + config.pixExpiresMinutes * 60_000),
  };
}

type AsaasPayment = { id: string };
type AsaasQr = { encodedImage: string; payload: string; expirationDate?: string };
type AsaasCustomer = { id: string };
type AsaasList<T> = { data?: T[] };

async function asaasCustomer(customer: PixRequest["customer"]) {
  if (!customer.cpfCnpj) throw new AppError("CPF/CNPJ obrigatório para o Asaas", "MISSING_DOCUMENT");
  const found = await asaas<AsaasList<AsaasCustomer>>(`/customers?cpfCnpj=${customer.cpfCnpj}`);
  if (found.data?.[0]?.id) return found.data[0].id;
  const created = await asaas<AsaasCustomer>("/customers", {
    method: "POST",
    body: JSON.stringify({
      name: customer.name,
      cpfCnpj: customer.cpfCnpj,
      email: customer.email || undefined,
      mobilePhone: customer.phone || undefined,
    }),
  });
  return created.id;
}

async function asaas<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return (await fetchJson(`${config.asaasApiUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        access_token: config.asaasApiKey,
        ...(init?.headers ?? {}),
      },
    })) as T;
  } catch (error) {
    if (error instanceof HttpError) {
      throw new AppError("O Asaas recusou a cobrança", "ASAAS_ERROR", 502);
    }
    throw error;
  }
}

type OpenPixCharge = { charge?: { correlationID?: string; brCode?: string; qrCodeImage?: string; expiresDate?: string } };

async function issueOpenPix(input: PixRequest): Promise<PixIssued> {
  if (!config.openPixAppId) throw new AppError("OPENPIX_APP_ID ausente", "PAYMENT_NOT_CONFIGURED", 503);
  const correlationID = input.externalReference.slice(0, 70);
  let body: OpenPixCharge;
  try {
    body = (await fetchJson(`${config.openPixApiUrl}/charge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: config.openPixAppId },
      body: JSON.stringify({
        correlationID,
        value: input.amountCents,
        comment: input.description.slice(0, 140),
        expiresIn: config.pixExpiresMinutes * 60,
      }),
    })) as OpenPixCharge;
  } catch (error) {
    if (error instanceof HttpError) throw new AppError("A OpenPix recusou a cobrança", "OPENPIX_ERROR", 502);
    throw error;
  }
  const charge = body.charge;
  if (!charge?.brCode || !charge.correlationID) throw new AppError("Resposta incompleta da OpenPix", "OPENPIX_ERROR", 502);
  return {
    provider: "openpix",
    externalId: charge.correlationID,
    pixCopyPaste: charge.brCode,
    qrCodeBase64: charge.qrCodeImage?.startsWith("data:")
      ? charge.qrCodeImage
      : await toQr(charge.brCode),
    expiresAt: charge.expiresDate ? new Date(charge.expiresDate) : new Date(Date.now() + config.pixExpiresMinutes * 60_000),
  };
}

export function sandboxEnabled() {
  return isSandboxPayment() && process.env.NODE_ENV !== "production";
}
