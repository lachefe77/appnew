import { z } from "zod";
import { isValidCpf, isValidCpfCnpj, onlyDigits } from "./cpf";

const digits = (value: string) => onlyDigits(value);

export const addressSchema = z.object({
  cep: z
    .string()
    .transform(digits)
    .refine((value) => value.length === 8, { message: "CEP inválido" }),
  street: z.string().trim().min(2, "Informe a rua").max(120),
  number: z.string().trim().min(1, "Informe o número").max(20),
  complement: z.string().trim().max(80).optional().default(""),
  district: z.string().trim().min(2, "Informe o bairro").max(80),
  city: z.string().trim().min(2, "Informe a cidade").max(80),
  state: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => /^[A-Z]{2}$/.test(value), { message: "UF inválida" }),
});

export const customerSchema = z.object({
  name: z.string().trim().min(3, "Informe o nome completo").max(120),
  cpf: z
    .string()
    .transform(digits)
    .refine(isValidCpf, { message: "CPF inválido" }),
  phone: z
    .string()
    .transform(digits)
    .refine((value) => value.length >= 10 && value.length <= 13, { message: "Telefone inválido" }),
  email: z.string().trim().email("E-mail inválido").optional().or(z.literal("")),
});

const lineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(5),
});

export const b2cOrderSchema = z
  .object({
    productId: z.string().min(1).optional(),
    quantity: z.number().int().min(1).max(5).optional(),
    items: z.array(lineSchema).min(1).max(12).optional(),
    clientRequestId: z.string().min(8).max(80).optional(),
    customer: customerSchema,
    address: addressSchema,
    payMethod: z.enum(["PIX", "BOLETO", "USDT"]).optional(),
  })
  .refine((value) => (value.items && value.items.length > 0) || Boolean(value.productId), {
    message: "Escolha ao menos um produto",
  });

export const b2bOrderSchema = b2cOrderSchema;

export const registerSchema = z.object({
  name: z.string().trim().min(3).max(120),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8, "A senha precisa de 8 caracteres").max(80),
  phone: z
    .string()
    .transform(digits)
    .refine((value) => value.length >= 10 && value.length <= 13, { message: "Telefone inválido" }),
  cpfCnpj: z
    .string()
    .transform(digits)
    .refine(isValidCpfCnpj, { message: "CPF ou CNPJ inválido" }),
  role: z.enum(["CUSTOMER", "RESELLER"]).default("CUSTOMER"),
});

export const loginSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1),
  next: z.string().optional(),
});

export const depositSchema = z.object({
  amountCents: z.number().int().positive(),
});

export const commerceSchema = z.object({
  spread: z.number().gt(1).lt(5),
  retailMultiplier: z.number().gt(1).lt(8),
  minDepositCents: z.number().int().min(1000).max(100_000_00),
  abandonedPixDelayMs: z.number().int().min(60_000).max(86_400_000),
  lowBalanceCents: z.number().int().min(0),
  cjLowBalanceCents: z.number().int().min(0),
  lowStockThreshold: z.number().int().min(1).max(100),
  lowStockBadge: z.number().int().min(1).max(100),
  shipDays: z.number().int().min(1).max(30),
});

export const productCreateSchema = z.object({
  action: z.literal("create"),
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().min(10).max(2000),
  category: z.enum(["ferramentas", "bem-estar", "pet"]),
  supplierSource: z.enum(["CJ_BRAZIL", "BLING_HUB"]),
  supplierSku: z.string().trim().min(2).max(60),
  supplierCostCents: z.number().int().positive(),
  platformWholesaleCents: z.number().int().positive(),
  suggestedRetailCents: z.number().int().positive(),
  stockQuantity: z.number().int().min(0).max(100000),
  shipDays: z.number().int().min(1).max(30),
});

export const productEditSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().min(10).max(2000),
  platformWholesaleCents: z.number().int().positive(),
  suggestedRetailCents: z.number().int().positive(),
  isActive: z.boolean(),
  shipDays: z.number().int().min(1).max(30),
  bundleQty: z.number().int().min(2).max(10).nullable(),
  bundlePriceCents: z.number().int().positive().nullable(),
});

export const customerSaveSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(3).max(120),
  cpf: z.string().transform(digits).refine(isValidCpf, { message: "CPF inválido" }),
  phone: z
    .string()
    .transform(digits)
    .refine((value) => value.length >= 10 && value.length <= 13, { message: "Telefone inválido" }),
  email: z.string().trim().email().optional().or(z.literal("")),
  note: z.string().trim().max(400).optional(),
});

export const lookupSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  cpf: z.string().transform(digits).refine(isValidCpf, { message: "CPF inválido" }),
});

export const adjustSchema = z.object({
  userId: z.string().min(1),
  amountCents: z.number().int().refine((value) => value !== 0, { message: "Informe um valor" }),
  reason: z.string().trim().min(3).max(180),
});

export type AddressInput = z.infer<typeof addressSchema>;
export type CustomerInput = z.infer<typeof customerSchema>;
export type B2COrderInput = z.infer<typeof b2cOrderSchema>;
