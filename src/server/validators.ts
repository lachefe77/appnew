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

export const b2cOrderSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(5),
  clientRequestId: z.string().min(8).max(80).optional(),
  customer: customerSchema,
  address: addressSchema,
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

export type AddressInput = z.infer<typeof addressSchema>;
export type B2COrderInput = z.infer<typeof b2cOrderSchema>;
