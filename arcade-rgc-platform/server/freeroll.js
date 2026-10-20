/**
 * Freeroll 8 jogadores — crédito fictício (buy-in 0). Bracket single-elim.
 */

export const FREEROLL_SIZE = 8;

export function createFreerollRegistration({ id } = {}) {
  return {
    id: id || "freeroll_" + Date.now(),
    size: FREEROLL_SIZE,
    buyInCents: 0,
    status: "REGISTERING",
    players: [],
    rounds: [],
    championId: null,
  };
}

export function createFreerollBracket(
  playerIds,
  { id = "freeroll_" + Date.now() } = {},
) {
  if (!Array.isArray(playerIds) || playerIds.length !== FREEROLL_SIZE) {
    throw new Error(`Freeroll exige exatamente ${FREEROLL_SIZE} jogadores.`);
  }
  if (new Set(playerIds).size !== FREEROLL_SIZE)
    throw new Error("Jogadores duplicados no freeroll.");

  const r1 = [];
  for (let i = 0; i < FREEROLL_SIZE; i += 2) {
    r1.push({
      matchIndex: i / 2,
      a: playerIds[i],
      b: playerIds[i + 1],
      winnerId: null,
      status: "PENDING",
    });
  }
  const r2 = [
    {
      matchIndex: 0,
      a: null,
      b: null,
      winnerId: null,
      status: "LOCKED",
      from: [0, 1],
    },
    {
      matchIndex: 1,
      a: null,
      b: null,
      winnerId: null,
      status: "LOCKED",
      from: [2, 3],
    },
  ];
  const r3 = [
    {
      matchIndex: 0,
      a: null,
      b: null,
      winnerId: null,
      status: "LOCKED",
      from: [0, 1],
    },
  ];
  return {
    id,
    size: FREEROLL_SIZE,
    buyInCents: 0,
    status: "RUNNING",
    players: [...playerIds],
    rounds: [r1, r2, r3],
    championId: null,
  };
}

export function registerFreerollPlayer(state, userId) {
  if (!state) throw new Error("Freeroll inexistente.");
  if (state.status === "RUNNING" || state.status === "DONE")
    throw new Error("Freeroll já em andamento ou encerrado.");
  if (state.players.includes(userId)) throw new Error("Já inscrito.");
  if (state.players.length >= FREEROLL_SIZE) throw new Error("Freeroll lotado.");
  state.players.push(userId);
  state.status = "REGISTERING";
  if (state.players.length === FREEROLL_SIZE) {
    const built = createFreerollBracket(state.players, { id: state.id });
    Object.assign(state, built);
  }
  return state;
}

/**
 * Agenda partidas PENDING com check-in; no-show promove o presente.
 */
export function freerollPendingSlots(state) {
  if (!state?.rounds) return [];
  const out = [];
  state.rounds.forEach((round, roundIndex) => {
    for (const m of round) {
      if (m.status === "PENDING" && m.a && m.b)
        out.push({ roundIndex, matchIndex: m.matchIndex, a: m.a, b: m.b });
    }
  });
  return out;
}

export function freerollCheckIn(state, roundIndex, matchIndex, userId) {
  const match = state.rounds[roundIndex]?.find((m) => m.matchIndex === matchIndex);
  if (!match) throw new Error("Partida inválida.");
  match.checkIn = match.checkIn || { a: false, b: false, deadline: Date.now() + 120000 };
  if (match.a === userId) match.checkIn.a = true;
  else if (match.b === userId) match.checkIn.b = true;
  else throw new Error("Jogador fora do confronto.");
  return match;
}

export function freerollResolveNoShows(state, now = Date.now()) {
  if (!state?.rounds) return [];
  const promoted = [];
  for (let ri = 0; ri < state.rounds.length; ri++) {
    for (const m of state.rounds[ri]) {
      if (m.status !== "PENDING") continue;
      const ci = m.checkIn;
      if (!ci?.deadline || now < ci.deadline) continue;
      if (ci.a && !ci.b) {
        reportFreerollWinner(state, ri, m.matchIndex, m.a);
        promoted.push({ matchIndex: m.matchIndex, winnerId: m.a, reason: "no-show" });
      } else if (ci.b && !ci.a) {
        reportFreerollWinner(state, ri, m.matchIndex, m.b);
        promoted.push({ matchIndex: m.matchIndex, winnerId: m.b, reason: "no-show" });
      }
    }
  }
  return promoted;
}

export function bindFreerollPlatformMatch(state, roundIndex, matchIndex, platformMatchId) {
  const match = state.rounds[roundIndex]?.find((m) => m.matchIndex === matchIndex);
  if (!match) throw new Error("Partida inválida.");
  match.platformMatchId = platformMatchId;
  match.status = "LIVE";
  return match;
}

export function reportFreerollWinner(state, roundIndex, matchIndex, winnerId) {
  if (!state || state.status !== "RUNNING")
    throw new Error("Freeroll não está em execução.");
  const round = state.rounds[roundIndex];
  if (!round) throw new Error("Rodada inválida.");
  const match = round.find((m) => m.matchIndex === matchIndex);
  if (!match || match.status === "DONE") throw new Error("Partida inválida.");
  if (match.status === "LOCKED") throw new Error("Partida ainda bloqueada.");
  if (![match.a, match.b].includes(winnerId))
    throw new Error("Vencedor não pertence à partida.");
  match.winnerId = winnerId;
  match.status = "DONE";

  const next = state.rounds[roundIndex + 1];
  if (!next) {
    state.championId = winnerId;
    state.status = "DONE";
    return state;
  }
  for (const nm of next) {
    if (!nm.from?.includes(matchIndex)) continue;
    if (nm.from[0] === matchIndex) nm.a = winnerId;
    if (nm.from[1] === matchIndex) nm.b = winnerId;
    if (nm.a && nm.b) nm.status = "PENDING";
  }
  if (roundIndex === state.rounds.length - 1) {
    state.championId = winnerId;
    state.status = "DONE";
  }
  return state;
}
