/**
 * Ready-check sincronizado: ambos ACK → countdown → liberar Start/RUNNING.
 * Estado puro (sem I/O) para testes unitários.
 */

// Padrão 0 = libera ao receber os 2 ACKs (compatível com testes/CI).
// Produção: READY_CHECK_COUNTDOWN_SEC=3 para overlay com contagem.
const DEFAULT_COUNTDOWN_SEC = Number(process.env.READY_CHECK_COUNTDOWN_SEC ?? 0);

export function createReadyCheck({
  matchId,
  countdownSec = DEFAULT_COUNTDOWN_SEC,
} = {}) {
  const sec = Number(countdownSec);
  return {
    matchId,
    phase: "WAITING_ACKS", // WAITING_ACKS | COUNTDOWN | DONE
    acks: new Set(),
    countdownSec: Number.isFinite(sec)
      ? Math.max(0, Math.min(10, sec))
      : 3,
    remaining: null,
  };
}

/** Registra ACK de um jogador. Retorna evento para broadcast ou null. */
export function ackReady(state, userId) {
  if (!state || state.phase !== "WAITING_ACKS") return null;
  state.acks.add(userId);
  if (state.acks.size < 2) {
    return {
      type: "READY_CHECK_UPDATE",
      matchId: state.matchId,
      acks: state.acks.size,
      need: 2,
      phase: state.phase,
    };
  }
  if (state.countdownSec <= 0) {
    state.phase = "DONE";
    state.remaining = 0;
    return {
      type: "READY_CHECK_DONE",
      matchId: state.matchId,
      remaining: 0,
      phase: state.phase,
    };
  }
  state.phase = "COUNTDOWN";
  state.remaining = state.countdownSec;
  return {
    type: "READY_CHECK_COUNTDOWN",
    matchId: state.matchId,
    remaining: state.remaining,
    phase: state.phase,
  };
}

/** Avança um tick do countdown. Retorna evento; se remaining chega a 0, DONE. */
export function tickCountdown(state) {
  if (!state || state.phase !== "COUNTDOWN") return null;
  state.remaining = Math.max(0, (state.remaining ?? state.countdownSec) - 1);
  if (state.remaining <= 0) {
    state.phase = "DONE";
    return {
      type: "READY_CHECK_DONE",
      matchId: state.matchId,
      remaining: 0,
      phase: state.phase,
    };
  }
  return {
    type: "READY_CHECK_COUNTDOWN",
    matchId: state.matchId,
    remaining: state.remaining,
    phase: state.phase,
  };
}

export function resetReadyCheck(state) {
  if (!state) return;
  state.phase = "WAITING_ACKS";
  state.acks = new Set();
  state.remaining = null;
}
