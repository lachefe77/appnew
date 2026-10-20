/**
 * Torneios com inscrição real (buy-in 0 ou débito via caller) + bracket single-elim.
 */
export class TournamentEngine {
  constructor() {
    this.tournaments = new Map();
    this.registrationEnabled = true;
    this.seedDefaultTournaments();
  }

  seedDefaultTournaments() {
    this.createTournament({
      id: "tour_corujao_01",
      title: "Corujão da Madrugada KOF 2002",
      gameCode: "kof2002",
      maxPlayers: 8,
      buyInCents: 1000,
      status: "OPEN",
      startTime: "23:00",
    });
    this.createTournament({
      id: "tour_freeroll_01",
      title: "Freeroll Diário de Boas-Vindas",
      gameCode: "kof2002",
      maxPlayers: 16,
      buyInCents: 0,
      status: "OPEN",
      startTime: "20:00",
    });
  }

  createTournament({
    id,
    title,
    gameCode,
    maxPlayers,
    buyInCents,
    startTime,
    status = "OPEN",
  }) {
    const t = {
      id,
      title,
      gameCode,
      maxPlayers,
      buyInCents,
      buyInReais: (buyInCents / 100).toFixed(2),
      status,
      startTime,
      players: [],
      bracket: [],
      registrationOpen: status === "OPEN",
    };
    this.tournaments.set(id, t);
    return t;
  }

  registerPlayer(tournamentId, userId, username) {
    const t = this.tournaments.get(tournamentId);
    if (!t) throw new Error("Torneio inexistente.");
    if (!t.registrationOpen || t.status !== "OPEN")
      throw new Error("Inscrições fechadas.");
    if (t.players.some((p) => p.userId === userId))
      throw new Error("Já inscrito.");
    if (t.players.length >= t.maxPlayers) throw new Error("Torneio lotado.");
    t.players.push({
      userId,
      username: username || userId,
      seed: t.players.length + 1,
    });
    if (t.players.length >= t.maxPlayers) {
      t.registrationOpen = false;
      t.status = "LOCKED";
      t.bracket = this.buildBracket(t.players.map((p) => p.userId));
    }
    return t;
  }

  buildBracket(playerIds) {
    const ids = [...playerIds];
    while (ids.length & (ids.length - 1)) ids.push(null); // bye padding
    const round1 = [];
    for (let i = 0; i < ids.length; i += 2) {
      round1.push({
        matchIndex: i / 2,
        a: ids[i],
        b: ids[i + 1],
        winnerId: null,
        status: ids[i + 1] == null ? "BYE" : "PENDING",
      });
    }
    for (const m of round1) {
      if (m.status === "BYE") {
        m.winnerId = m.a;
        m.status = "DONE";
      }
    }
    return [round1];
  }

  getAllTournaments() {
    return Array.from(this.tournaments.values()).map((t) => ({
      ...t,
      registrationOpen: t.registrationOpen && t.status === "OPEN",
      slotsLeft: Math.max(0, t.maxPlayers - t.players.length),
    }));
  }

  get(id) {
    return this.tournaments.get(id);
  }
}

export const tournamentEngine = new TournamentEngine();
