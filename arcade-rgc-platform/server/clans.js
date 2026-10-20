/**
 * Clãs persistentes (SQLite via sistema-plano).
 */
import { PlanoClans } from "./sistema-plano.js";

export class ClanSystem {
  createClan(tag, name, description, leaderId) {
    return PlanoClans.create(tag, name, description, leaderId);
  }

  joinClan(tag, userId) {
    return PlanoClans.join(tag, userId);
  }

  leaveClan(userId) {
    PlanoClans.leave(userId);
  }

  recordMatchResult(winnerId, loserId, stakeCents) {
    PlanoClans.recordMatch(winnerId, loserId, stakeCents);
  }

  /** Compat legado: tags diretas (se ainda existirem em memória). */
  recordMatchByTags(winnerTag, loserTag, stakeCents) {
    // Preferir IDs de utilizador; tags só actualizam se existirem.
    if (winnerTag && PlanoClans.get(winnerTag)) {
      const c = PlanoClans.get(winnerTag);
      // noop — pontos reais vêm de recordMatchResult com userIds
      void c;
      void loserTag;
      void stakeCents;
    }
  }

  getLeaderboard() {
    return PlanoClans.list().map((c) => ({
      tag: c.tag,
      name: c.name,
      description: c.description,
      leaderId: c.leader_id,
      points: c.points,
      wins: c.wins,
      losses: c.losses,
      members: c.members,
      level: Math.max(1, Math.floor(c.points / 2500) + 1),
      treasuryReais: "0,00",
    }));
  }

  ofUser(userId) {
    return PlanoClans.ofUser(userId);
  }
}

export const clanSystem = new ClanSystem();
