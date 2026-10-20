/**
 * Capacidade hosted + helpers de fila (Fase 4).
 */
import { resolveHostedEngine } from "./host-bot-factory.js";

/**
 * HOSTED_MAX_SESSIONS:
 * - se definido no env → usa esse valor
 * - native sem env → 6 (calibrado bench Fase 3 no PC/VPS 4GB)
 * - chrome sem env → 1
 */
export function resolveHostedMaxSessions(
  env = process.env,
  engine = resolveHostedEngine(env.HOSTED_ENGINE),
) {
  const raw = env.HOSTED_MAX_SESSIONS;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    return Math.max(1, Number.isFinite(n) ? Math.floor(n) : 1);
  }
  return engine === "native" ? 6 : 1;
}

export function isHostedBusy(activeCount, cap) {
  return Math.max(0, Number(activeCount) || 0) >= Math.max(1, Number(cap) || 1);
}

/** ETA simples: posição * segundos médios por partida. */
export function queueEta(position, avgMatchSec = 180) {
  const placeInQueue = Math.max(1, Number(position) || 1);
  const sec = Math.max(30, Number(avgMatchSec) || 180);
  return {
    placeInQueue,
    position: placeInQueue,
    etaSeconds: placeInQueue * sec,
  };
}
