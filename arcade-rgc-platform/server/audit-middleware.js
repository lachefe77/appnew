/**
 * Helpers de auditoria usados pela plataforma.
 * Escreve em audit_trail (e espelho legado) via AuditLog.
 */
import { AuditLog } from "./db.js";
import { normalizeRole } from "./roles.js";

/**
 * Registra um evento de auditoria.
 * @param {{ id?: string, role?: string, actorId?: string, actorRole?: string, ip?: string }|string|null} actor
 * @param {string} action
 * @param {object|string} [detail]
 */
export function audit(actor, action, detail = {}) {
  const meta =
    detail != null && typeof detail === "object" && !Array.isArray(detail)
      ? detail
      : { detail };
  const actorId =
    typeof actor === "string"
      ? actor
      : actor?.id || actor?.actorId || actor?.userId || "SYSTEM";
  let actorRole = "SYSTEM";
  if (typeof actor !== "string" && actor) {
    const raw = actor.role || actor.actorRole || actor.actor_role;
    actorRole = normalizeRole(raw) || raw || "SYSTEM";
  }

  AuditLog.record({
    actorId,
    actorRole,
    action: String(action || ""),
    targetType: meta.targetType || meta.target_type || "",
    targetId: meta.targetId || meta.target_id || "",
    roomId: meta.roomId || meta.room_id || "",
    matchId: meta.matchId || meta.match_id || "",
    ip: meta.ip || actor?.ip || "",
    meta,
  });
}

export function auditFromRequest(req, actor, action, detail = {}) {
  const ip =
    req?.headers?.["x-forwarded-for"]?.split?.(",")?.[0]?.trim() ||
    req?.socket?.remoteAddress ||
    "";
  return audit(actor, action, { ...detail, ip });
}

export default { audit, auditFromRequest };
