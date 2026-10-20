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
