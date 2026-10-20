/**
 * Torneios com inscrição, bracket single-elim e avanço por resultado de partida.
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
      liveMatches: [], // { roundIndex, matchIndex, platformMatchId, a, b }
      registrationOpen: status === "OPEN",
      championId: null,
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
      t.status = "RUNNING";
      t.bracket = this.buildFullBracket(t.players.map((p) => p.userId));
    }
    return t;
  }

  buildFullBracket(playerIds) {
    const ids = [...playerIds];
    while (ids.length & (ids.length - 1)) ids.push(null);
    const rounds = [];
    let current = ids;
    while (current.length >= 2) {
      const round = [];
      for (let i = 0; i < current.length; i += 2) {
        const a = current[i];
        const b = current[i + 1];
        const bye = b == null && a != null;
        round.push({
          matchIndex: i / 2,
          a,
          b,
          winnerId: bye ? a : null,
          status: bye ? "DONE" : a && b ? "PENDING" : "LOCKED",
          platformMatchId: null,
          checkIn: { a: false, b: false },
        });
      }
      rounds.push(round);
      current = round.map((m) => m.winnerId);
      if (current.every((x) => x == null) && round.length === 1) break;
      if (round.length === 1) break;
      // next round slots start locked until winners known
      if (rounds.length && !current.some(Boolean)) {
        // build empty next
        const nextLen = Math.ceil(round.length / 2);
        if (nextLen < 1) break;
      }
      // rebuild next from winners only once
      current = new Array(Math.ceil(round.length / 2)).fill(null);
      // stop loop properly: create next round skeleton
      if (round.length === 1) break;
      const next = [];
      for (let i = 0; i < round.length; i += 2) {
        next.push({
          matchIndex: i / 2,
          a: round[i]?.status === "DONE" ? round[i].winnerId : null,
          b: round[i + 1]?.status === "DONE" ? round[i + 1].winnerId : null,
          winnerId: null,
          status: "LOCKED",
          from: [i, i + 1],
          platformMatchId: null,
          checkIn: { a: false, b: false },
        });
        const nm = next[next.length - 1];
        if (nm.a && nm.b) nm.status = "PENDING";
        else if (nm.a && round[i + 1]?.status === "DONE" && !nm.b) {
          nm.winnerId = nm.a;
          nm.status = "DONE";
        }
      }
      rounds.push(next);
      // continue only if more rounds needed
      if (next.length <= 1) break;
      // flatten for while — break after building remaining via advance
      break;
    }
    // ensure final exists for 8-player
    this.ensureNextRounds(rounds);
    return rounds;
  }

  ensureNextRounds(rounds) {
    while (rounds.length && rounds[rounds.length - 1].length > 1) {
      const prev = rounds[rounds.length - 1];
      const next = [];
      for (let i = 0; i < prev.length; i += 2) {
        next.push({
          matchIndex: i / 2,
          a: prev[i]?.status === "DONE" ? prev[i].winnerId : null,
          b: prev[i + 1]?.status === "DONE" ? prev[i + 1].winnerId : null,
          winnerId: null,
          status: "LOCKED",
          from: [i, i + 1],
          platformMatchId: null,
          checkIn: { a: false, b: false },
        });
        const nm = next[next.length - 1];
        if (nm.a && nm.b) nm.status = "PENDING";
      }
      rounds.push(next);
    }
  }

  pendingMatches(tournamentId) {
    const t = this.get(tournamentId);
    if (!t?.bracket?.length) return [];
    const out = [];
    t.bracket.forEach((round, roundIndex) => {
      for (const m of round) {
        if (m.status === "PENDING" && m.a && m.b)
          out.push({ tournamentId, roundIndex, ...m });
      }
    });
    return out;
  }

  bindPlatformMatch(tournamentId, roundIndex, matchIndex, platformMatchId) {
    const t = this.get(tournamentId);
    const m = t?.bracket?.[roundIndex]?.find((x) => x.matchIndex === matchIndex);
    if (!m) throw new Error("Slot de bracket inválido.");
    m.platformMatchId = platformMatchId;
    m.status = "LIVE";
    t.liveMatches.push({
      roundIndex,
      matchIndex,
      platformMatchId,
      a: m.a,
      b: m.b,
    });
    return m;
  }

  reportWinner(tournamentId, roundIndex, matchIndex, winnerId) {
    const t = this.get(tournamentId);
    if (!t) throw new Error("Torneio inexistente.");
    const round = t.bracket[roundIndex];
    const m = round?.find((x) => x.matchIndex === matchIndex);
    if (!m) throw new Error("Partida inválida.");
    if (![m.a, m.b].includes(winnerId))
      throw new Error("Vencedor não está no confronto.");
    m.winnerId = winnerId;
    m.status = "DONE";
    const next = t.bracket[roundIndex + 1];
    if (!next) {
      t.championId = winnerId;
      t.status = "DONE";
      return t;
    }
    for (const nm of next) {
      if (!nm.from?.includes(matchIndex)) continue;
      if (nm.from[0] === matchIndex) nm.a = winnerId;
      if (nm.from[1] === matchIndex) nm.b = winnerId;
      if (nm.a && nm.b) nm.status = "PENDING";
    }
    if (next.every((x) => x.status === "DONE")) {
      const final = next[0];
      if (next.length === 1 && final.winnerId) {
        t.championId = final.winnerId;
        t.status = "DONE";
      }
    }
    return t;
  }

  checkIn(tournamentId, roundIndex, matchIndex, userId) {
    const t = this.get(tournamentId);
    const m = t?.bracket?.[roundIndex]?.find((x) => x.matchIndex === matchIndex);
    if (!m) throw new Error("Partida inválida.");
    if (m.a === userId) m.checkIn.a = true;
    else if (m.b === userId) m.checkIn.b = true;
    else throw new Error("Você não está neste confronto.");
    return m;
  }

  getAllTournaments() {
    return Array.from(this.tournaments.values()).map((t) => ({
      ...t,
      registrationOpen: t.registrationOpen && t.status === "OPEN",
      slotsLeft: Math.max(0, t.maxPlayers - t.players.length),
      pending: this.pendingMatches(t.id).length,
    }));
  }

  get(id) {
    return this.tournaments.get(id);
  }
}

export const tournamentEngine = new TournamentEngine();
