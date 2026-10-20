export class ClanSystem {
  constructor() {
    this.clans = new Map();
    this.seedDefaultClans();
  }

  seedDefaultClans() {
    this.createClan('ORO', 'Orochi Bloodline', 'Líder dos Golpes Proibidos', 'usr_admin');
    this.createClan('NEO', 'NeoGeo Masters BR', 'Veteranos dos Fliperamas da Lapa', 'usr_demo_kyc');
    this.createClan('KOF', 'KOF Syndicate', 'Os melhores do Norte/Nordeste', 'usr_kof_king');

    const oro = this.clans.get('ORO');
    if (oro) { oro.points = 14850; oro.wins = 312; oro.losses = 48; oro.members = 18; oro.level = 5; oro.treasuryReais = '2.450,00'; }

    const neo = this.clans.get('NEO');
    if (neo) { neo.points = 11200; neo.wins = 240; neo.losses = 65; neo.members = 14; neo.level = 4; neo.treasuryReais = '1.180,00'; }

    const kof = this.clans.get('KOF');
    if (kof) { kof.points = 8940; kof.wins = 180; kof.losses = 72; kof.members = 12; kof.level = 3; kof.treasuryReais = '620,00'; } // bug fix: was neo.treasuryReais
  }

  createClan(tag, name, description, leaderId) {
    const cleanTag = tag.toUpperCase().slice(0, 4);
    if (this.clans.has(cleanTag)) throw new Error(`Tag [${cleanTag}] já em uso.`);

    const clan = { tag: cleanTag, name, description, leaderId, createdDate: new Date().toISOString(), points: 1000, level: 1, members: 1, wins: 0, losses: 0, treasuryReais: '0,00' };
    this.clans.set(cleanTag, clan);
    return clan;
  }

  recordMatchResult(winnerTag, loserTag, stakeCents) {
    if (winnerTag && this.clans.has(winnerTag)) {
      const c = this.clans.get(winnerTag);
      c.wins++;
      c.points += Math.floor(25 + (stakeCents / 100));
    }
    if (loserTag && this.clans.has(loserTag)) {
      const c = this.clans.get(loserTag);
      c.losses++;
      c.points = Math.max(0, c.points - 10);
    }
  }

  getLeaderboard() {
    return Array.from(this.clans.values()).sort((a, b) => b.points - a.points);
  }
}

export const clanSystem = new ClanSystem();
