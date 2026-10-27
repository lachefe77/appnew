import type { Role } from "@prisma/client";

export const staffRoles: Role[] = ["MASTER", "ADMIN", "SUPPORT", "OPERATOR"];
export const deskRoles: Role[] = ["MASTER", "ADMIN"];
export const sellerRoles: Role[] = ["RESELLER", "ADMIN", "MASTER"];

export function isStaff(role: string) {
  return role === "MASTER" || role === "ADMIN" || role === "SUPPORT" || role === "OPERATOR";
}

export function roleLabel(role: string) {
  if (role === "MASTER") return "Mestre";
  if (role === "ADMIN") return "Administrador";
  if (role === "SUPPORT" || role === "OPERATOR") return "Suporte";
  if (role === "RESELLER") return "Revendedor";
  return "Usuário";
}

export function homePath(role: string) {
  if (isStaff(role)) return "/admin";
  if (role === "RESELLER") return "/painel";
  return "/";
}
