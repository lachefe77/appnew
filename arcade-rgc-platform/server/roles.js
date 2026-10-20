/**
 * RBAC — hierarquia e permissões da plataforma.
 * Ordem: MASTER (mais alto) → GUEST (mais baixo).
 */

export const ROLE_ORDER = [
  "MASTER",
  "ADMIN",
  "MODERATOR",
  "SUPPORT",
  "VIP",
  "USER",
  "GUEST",
];

const ROLE_RANK = Object.fromEntries(
  ROLE_ORDER.map((role, index) => [role, ROLE_ORDER.length - index]),
);

/** Permissão → papel mínimo necessário (hierarquia inclusiva). */
export const PERMISSIONS = {
  "admin.panel": "ADMIN",
  "admin.users": "ADMIN",
  "admin.finance": "ADMIN",
  "admin.reviews": "ADMIN",
  "admin.seasons": "ADMIN",
  "admin.audit": "ADMIN",
  "admin.kyc": "ADMIN",
  "admin.withdrawals": "ADMIN",
  "admin.master": "MASTER",
  "mod.chat": "MODERATOR",
  "mod.rooms": "MODERATOR",
  "mod.matches": "MODERATOR",
  "support.tickets": "SUPPORT",
  "support.view_users": "SUPPORT",
  "vip.queue_priority": "VIP",
  "play.match": "USER",
  "play.challenge": "USER",
  "play.wallet": "USER",
  "guest.browse": "GUEST",
};

export function normalizeRole(role) {
  if (role == null || role === "") return "GUEST";
  const normalized = String(role).trim().toUpperCase();
  if (ROLE_RANK[normalized] == null) return null;
  return normalized;
}

export function roleAtLeast(userRole, required) {
  const have = normalizeRole(userRole);
  const need = normalizeRole(required);
  if (!have || !need) return false;
  return ROLE_RANK[have] >= ROLE_RANK[need];
}

/**
 * @param {{ role?: string } | string | null | undefined} user
 * @param {string} permission
 */
export function can(user, permission) {
  const minRole = PERMISSIONS[permission];
  if (!minRole) return false;
  const role =
    typeof user === "string" || user == null
      ? user
      : user.role ?? user.actor_role ?? null;
  return roleAtLeast(role, minRole);
}

export function isValidRole(role) {
  return normalizeRole(role) != null;
}

export function assignableRoles(actorRole) {
  const actor = normalizeRole(actorRole);
  if (!actor) return [];
  if (actor === "MASTER") return ROLE_ORDER.filter((r) => r !== "MASTER");
  if (actor === "ADMIN")
    return ROLE_ORDER.filter((r) => !["MASTER", "ADMIN"].includes(r));
  return [];
}

export default {
  ROLE_ORDER,
  PERMISSIONS,
  normalizeRole,
  roleAtLeast,
  can,
  isValidRole,
  assignableRoles,
};
