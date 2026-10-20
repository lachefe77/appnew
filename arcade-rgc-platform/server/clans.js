/**
 * Clãs persistentes (SQLite) + tesouraria.
 */
import { PlanoClans } from "./sistema-plano.js";
import { ClanTreasury } from "./plano-30.js";

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

  invite(tag, userId, byUserId) {
    return PlanoClans.invite(tag, userId, byUserId);
  }

  kick(tag, targetId, byUserId) {
    return PlanoClans.kick(tag, targetId, byUserId);
  }

  transferLeader(tag, newLeaderId, byUserId) {
    return PlanoClans.transferLeader(tag, newLeaderId, byUserId);
  }

  setRole(tag, userId, role, byUserId) {
    return PlanoClans.setRole(tag, userId, role, byUserId);
  }

  recordMatchResult(winnerId, loserId, stakeCents) {
    const tags = PlanoClans.recordMatch(winnerId, loserId, stakeCents);
    if (tags?.winnerTag && stakeCents > 0) {
      // 5% do stake vai pra tesouraria do clã vencedor (fichas fictícias)
      ClanTreasury.credit(
        tags.winnerTag,
        Math.floor(stakeCents * 0.05),
        "match_rake_share",
      );
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
      treasuryCents: ClanTreasury.balance(c.tag),
      treasuryReais: (ClanTreasury.balance(c.tag) / 100).toFixed(2),
    }));
  }

  ofUser(userId) {
    const c = PlanoClans.ofUser(userId);
    if (!c) return null;
    return {
      ...c,
      treasuryCents: ClanTreasury.balance(c.tag),
      treasuryReais: (ClanTreasury.balance(c.tag) / 100).toFixed(2),
      membersList: PlanoClans.members(c.tag),
    };
  }
}

export const clanSystem = new ClanSystem();
