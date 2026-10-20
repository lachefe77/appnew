/**
 * Temporadas competitivas — ativação e reset de ELO.
 * Operações administrativas; permissões via roles.js (admin.seasons).
 */
import crypto from "node:crypto";
import db, { AuditLog, SeasonsStore } from "./db.js";
import { can } from "./roles.js";

const DEFAULT_ELO = 1200;

export function getActiveSeason() {
  return SeasonsStore.getActive() || null;
}

/**
 * Ativa uma temporada (desativa as demais). Cria se ainda não existir.
 * @param {{ id?: string, name: string, startsAt?: string, endsAt?: string|null, actor?: object }} opts
 */
export function activateSeason(opts = {}) {
  const actor = opts.actor;
  if (actor && !can(actor, "admin.seasons")) {
    throw new Error("Acesso negado: admin.seasons.");
  }
  const name = String(opts.name || "").trim();
  if (!name) throw new Error("Nome da temporada obrigatório.");
  const id = String(opts.id || crypto.randomUUID());
  const startsAt = opts.startsAt || new Date().toISOString();
  const endsAt = opts.endsAt ?? null;

  const season = db.transaction(() => {
    SeasonsStore.deactivateAll();
    const existing = SeasonsStore.get(id);
    SeasonsStore.upsert({
      id,
      name,
      startsAt: existing?.starts_at || startsAt,
      endsAt,
      active: 1,
      eloResetDone: existing?.elo_reset_done ? 1 : 0,
    });
    return SeasonsStore.get(id);
  })();

  AuditLog.record({
    actorId: actor?.id || "SYSTEM",
    actorRole: actor?.role || "SYSTEM",
    action: "SEASON_ACTIVATE",
    targetType: "season",
    targetId: season.id,
    meta: { name: season.name, startsAt: season.starts_at },
  });

  return season;
}

/**
 * Zera ELO de todos os usuários para a temporada ativa (ou id informado).
 * Idempotente por temporada via elo_reset_done.
 */
export function resetEloForSeason(opts = {}) {
  const actor = opts.actor;
  if (actor && !can(actor, "admin.seasons")) {
    throw new Error("Acesso negado: admin.seasons.");
  }
  const seasonId = opts.seasonId || getActiveSeason()?.id;
  if (!seasonId) throw new Error("Nenhuma temporada ativa.");
  const season = SeasonsStore.get(seasonId);
  if (!season) throw new Error("Temporada não encontrada.");
  if (season.elo_reset_done && !opts.force) {
    return { season, reset: false, repeated: true };
  }

  const defaultElo = Number.isSafeInteger(opts.defaultElo)
    ? opts.defaultElo
    : DEFAULT_ELO;

  const result = db.transaction(() => {
    SeasonsStore.resetAllElo(defaultElo);
    SeasonsStore.markEloResetDone(seasonId);
    return SeasonsStore.get(seasonId);
  })();

  AuditLog.record({
    actorId: actor?.id || "SYSTEM",
    actorRole: actor?.role || "SYSTEM",
    action: "SEASON_ELO_RESET",
    targetType: "season",
    targetId: seasonId,
    meta: { defaultElo, force: !!opts.force },
  });

  return { season: result, reset: true, repeated: false };
}

export default {
  getActiveSeason,
  activateSeason,
  resetEloForSeason,
};
