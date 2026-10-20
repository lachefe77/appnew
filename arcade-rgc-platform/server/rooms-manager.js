/**
 * ARENA ARCADE — Room Manager
 * CRUD completo para salas + sistema de moderadores (até 5 por sala).
 */

export class RoomManager {
  constructor(initialRooms = []) {
    this.rooms = initialRooms;
  }

  getAll() {
    return this.rooms;
  }

  getById(roomId) {
    return this.rooms.find(r => r.id === roomId) || null;
  }

  create({ name, game, region, rakePercent, tier, description, maxPlayers, password, createdBy }) {
    if (!name || !name.trim()) throw new Error('Nome da sala é obrigatório.');
    if (this.rooms.length >= 50) throw new Error('Limite de 50 salas atingido.');

    const roomId = 'room_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const room = {
      id: roomId,
      name: name.trim().substring(0, 60),
      game: (game || 'KOF 2002').trim(),
      region: (region || 'Nacional').trim(),
      description: (description || '').trim().substring(0, 200),
      count: 0,
      rakePercent: Math.min(20, Math.max(0, parseInt(rakePercent, 10) || 10)),
      tier: ['LIVRE', 'PRO', 'VIP', 'DIAMANTE'].includes(tier) ? tier : 'LIVRE',
      maxPlayers: Math.min(500, Math.max(2, parseInt(maxPlayers, 10) || 100)),
      password: password || null,
      active: true,
      moderators: [],
      cabinetQueue: [],
      createdBy: createdBy || 'SYSTEM',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.rooms.push(room);
    return room;
  }

  update(roomId, { name, game, region, rakePercent, tier, description, maxPlayers, password, active }) {
    const room = this.getById(roomId);
    if (!room) throw new Error('Sala não encontrada.');

    if (name !== undefined)        room.name        = name.trim().substring(0, 60);
    if (game !== undefined)        room.game        = game.trim();
    if (region !== undefined)      room.region      = region.trim();
    if (description !== undefined) room.description = description.trim().substring(0, 200);
    if (rakePercent !== undefined) room.rakePercent = Math.min(20, Math.max(0, parseInt(rakePercent, 10)));
    if (tier !== undefined && ['LIVRE', 'PRO', 'VIP', 'DIAMANTE'].includes(tier)) room.tier = tier;
    if (maxPlayers !== undefined)  room.maxPlayers  = Math.min(500, Math.max(2, parseInt(maxPlayers, 10)));
    if (password !== undefined)    room.password    = password || null;
    if (active !== undefined)      room.active      = Boolean(active);
    room.updatedAt = new Date().toISOString();
    return room;
  }

  delete(roomId) {
    const idx = this.rooms.findIndex(r => r.id === roomId);
    if (idx === -1) throw new Error('Sala não encontrada.');
    const [removed] = this.rooms.splice(idx, 1);
    return removed;
  }

  toggle(roomId) {
    const room = this.getById(roomId);
    if (!room) throw new Error('Sala não encontrada.');
    room.active = !room.active;
    room.updatedAt = new Date().toISOString();
    return room;
  }

  // ── Moderators ─────────────────────────────────────────────────────────────

  addModerator(roomId, { userId, username, addedBy }) {
    const room = this.getById(roomId);
    if (!room) throw new Error('Sala não encontrada.');
    if (room.moderators.length >= 5) throw new Error('Limite de 5 moderadores por sala atingido.');
    if (room.moderators.some(m => m.userId === userId)) throw new Error('Usuário já é moderador desta sala.');

    const mod = {
      userId, username,
      addedBy: addedBy || 'ADMIN',
      addedAt: new Date().toISOString()
    };
    room.moderators.push(mod);
    room.updatedAt = new Date().toISOString();
    return mod;
  }

  removeModerator(roomId, userId) {
    const room = this.getById(roomId);
    if (!room) throw new Error('Sala não encontrada.');
    const idx = room.moderators.findIndex(m => m.userId === userId);
    if (idx === -1) throw new Error('Moderador não encontrado nesta sala.');
    const [removed] = room.moderators.splice(idx, 1);
    room.updatedAt = new Date().toISOString();
    return removed;
  }

  isModerator(roomId, userId) {
    const room = this.getById(roomId);
    if (!room) return false;
    return room.moderators.some(m => m.userId === userId);
  }

  getModerators(roomId) {
    const room = this.getById(roomId);
    return room ? room.moderators : [];
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  updateCount(clients) {
    for (const room of this.rooms) {
      let count = 0;
      for (const [, c] of clients.entries()) {
        if (c.roomId === room.id) count++;
      }
      room.count = count;
    }
  }

  /** Returns public room list (hides password hash) */
  publicList() {
    return this.rooms
      .filter(r => r.active)
      .map(r => ({
        id: r.id, name: r.name, game: r.game, region: r.region,
        description: r.description, count: r.count,
        rakePercent: r.rakePercent, tier: r.tier,
        maxPlayers: r.maxPlayers, hasPassword: !!r.password,
        moderatorCount: r.moderators.length
      }));
  }

  /** Returns admin room list (includes inactive, passwords, moderators) */
  adminList() {
    return this.rooms.map(r => ({
      ...r,
      password: r.password ? '***DEFINIDA***' : null
    }));
  }
}
