/**
 * ARENA ARCADE REPLAY & FORENSICS ENGINE
 * Armazena e reproduz frames de partidas apostadas para perícia técnica e anti-cheat.
 */

export class ReplayEngine {
  constructor() {
    this.replays = new Map(); // matchId -> ReplayData
    this.maxStoredReplays = 1000;
  }

  startRecording(matchId, p1Id, p2Id, stakeCents, gameTitle = 'The King of Fighters 2002') {
    const replaySession = {
      matchId,
      gameTitle,
      startTime: new Date().toISOString(),
      endTime: null,
      p1: { id: p1Id, character: 'Iori Yagami' },
      p2: { id: p2Id, character: 'Kyo Kusanagi' },
      stakeCents,
      totalFrames: 0,
      frames: [], // Array de { frame, p1Input, p2Input, crc32 }
      winnerId: null,
      desyncDetected: false,
      crcHistory: []
    };
    this.replays.set(matchId, replaySession);
    return replaySession;
  }

  recordFrame(matchId, frameNumber, p1Input, p2Input, crc32 = 0) {
    const session = this.replays.get(matchId);
    if (!session) return;

    session.totalFrames++;
    session.frames.push({
      f: frameNumber,
      p1: p1Input,
      p2: p2Input,
      c: crc32
    });

    if (crc32) {
      session.crcHistory.push(crc32);
    }
  }

  finishRecording(matchId, winnerId) {
    const session = this.replays.get(matchId);
    if (!session) return null;

    session.endTime = new Date().toISOString();
    session.winnerId = winnerId;
    return session;
  }

  getReplay(matchId) {
    return this.replays.get(matchId) || null;
  }

  listRecentReplays() {
    const list = [];
    for (const [, rep] of this.replays.entries()) {
      list.push({
        matchId: rep.matchId,
        gameTitle: rep.gameTitle,
        startTime: rep.startTime,
        durationSeconds: (rep.totalFrames / 60).toFixed(1),
        p1: rep.p1,
        p2: rep.p2,
        stakeReais: (rep.stakeCents / 100).toFixed(2),
        winnerId: rep.winnerId,
        totalFrames: rep.totalFrames,
        desyncDetected: rep.desyncDetected
      });
    }
    return list.reverse();
  }
}

export const replayEngine = new ReplayEngine();
