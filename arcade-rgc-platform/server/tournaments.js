/**
 * Catálogo de torneios (somente leitura / anúncio).
 * Inscrições com buy-in e brackets oficiais ainda não usam finance.js —
 * por isso o registro monetário permanece desabilitado até a integração.
 */
export class TournamentEngine {
  constructor() {
    this.tournaments = new Map();
    this.registrationEnabled = false;
    this.seedDefaultTournaments();
  }

  seedDefaultTournaments() {
    this.createTournament({
      id: "tour_corujao_01",
      title: "Corujão da Madrugada KOF 2002 — Em breve",
      gameCode: "kof2002",
      maxPlayers: 8,
      buyInCents: 1000,
      status: "ANNOUNCED",
      startTime: "23:00",
    });

    this.createTournament({
      id: "tour_freeroll_01",
      title: "Freeroll Diário de Boas-Vindas — Em breve",
      gameCode: "kof2002",
      maxPlayers: 16,
      buyInCents: 0,
      status: "ANNOUNCED",
      startTime: "20:00",
    });
  }

  createTournament({ id, title, gameCode, maxPlayers, buyInCents, startTime, status = "ANNOUNCED" }) {
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
      registrationOpen: false,
    };
    this.tournaments.set(id, t);
    return t;
  }

  registerPlayer() {
    throw new Error(
      "Inscrições de torneio ainda não estão habilitadas. Use salas de duelo KOF 2002.",
    );
  }

  getAllTournaments() {
    return Array.from(this.tournaments.values()).map((t) => ({
      ...t,
      registrationOpen: false,
      note: "Torneios oficiais serão liberados após integração com a carteira SQLite.",
    }));
  }
}
