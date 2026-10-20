/**
 * Replay / input journal — memória + persistência em disco (JSONL por partida).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDir = () =>
  process.env.REPLAY_DIR || path.join(root, "data", "replays");

export class ReplayEngine {
  constructor({ dir = defaultDir(), maxStoredReplays = 1000 } = {}) {
    this.replays = new Map();
    this.maxStoredReplays = maxStoredReplays;
    this.dir = dir;
  }

  ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  fileFor(matchId) {
    const safe = String(matchId).replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.dir, `${safe}.jsonl`);
  }

  metaPath(matchId) {
    const safe = String(matchId).replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.dir, `${safe}.meta.json`);
  }

  startRecording(matchId, p1Id, p2Id, stakeCents, gameTitle = "The King of Fighters 2002") {
    const replaySession = {
      matchId,
      gameTitle,
      startTime: new Date().toISOString(),
      endTime: null,
      p1: { id: p1Id },
      p2: { id: p2Id },
      stakeCents,
      totalFrames: 0,
      frames: [],
      winnerId: null,
      desyncDetected: false,
      crcHistory: [],
      persistent: true,
    };
    this.replays.set(matchId, replaySession);
    try {
      this.ensureDir();
      fs.writeFileSync(this.metaPath(matchId), JSON.stringify(replaySession, null, 2));
      fs.writeFileSync(this.fileFor(matchId), "");
    } catch (e) {
      console.error("[REPLAY] persist start", e.message);
    }
    return replaySession;
  }

  recordFrame(matchId, frameNumber, p1Input, p2Input, crc32 = 0) {
    const session = this.replays.get(matchId);
    if (!session) return;
    const row = { f: frameNumber, p1: p1Input, p2: p2Input, c: crc32 };
    session.totalFrames++;
    session.frames.push(row);
    if (crc32) session.crcHistory.push(crc32);
    try {
      fs.appendFileSync(this.fileFor(matchId), JSON.stringify(row) + "\n");
    } catch {}
  }

  /** Registra um input individual (journal) sem exigir frame de ambos. */
  recordInput(matchId, input) {
    const session = this.replays.get(matchId);
    if (!session) return;
    const row = { t: Date.now(), ...input };
    session.frames.push(row);
    session.totalFrames++;
    try {
      fs.appendFileSync(this.fileFor(matchId), JSON.stringify(row) + "\n");
    } catch {}
  }

  finishRecording(matchId, winnerId) {
    const session = this.replays.get(matchId);
    if (!session) return null;
    session.endTime = new Date().toISOString();
    session.winnerId = winnerId;
    try {
      this.ensureDir();
      const { frames, ...meta } = session;
      fs.writeFileSync(
        this.metaPath(matchId),
        JSON.stringify({ ...meta, totalFrames: session.totalFrames }, null, 2),
      );
    } catch (e) {
      console.error("[REPLAY] persist finish", e.message);
    }
    this.trim();
    return session;
  }

  trim() {
    if (this.replays.size <= this.maxStoredReplays) return;
    const keys = [...this.replays.keys()];
    while (this.replays.size > this.maxStoredReplays) {
      this.replays.delete(keys.shift());
    }
  }

  getReplay(matchId) {
    if (this.replays.has(matchId)) return this.replays.get(matchId);
    try {
      const meta = JSON.parse(fs.readFileSync(this.metaPath(matchId), "utf8"));
      const lines = fs
        .readFileSync(this.fileFor(matchId), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      return { ...meta, frames: lines };
    } catch {
      return null;
    }
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
        desyncDetected: rep.desyncDetected,
        persistent: true,
      });
    }
    try {
      this.ensureDir();
      for (const name of fs.readdirSync(this.dir)) {
        if (!name.endsWith(".meta.json")) continue;
        const meta = JSON.parse(
          fs.readFileSync(path.join(this.dir, name), "utf8"),
        );
        if (list.some((l) => l.matchId === meta.matchId)) continue;
        list.push({
          matchId: meta.matchId,
          gameTitle: meta.gameTitle,
          startTime: meta.startTime,
          durationSeconds: ((meta.totalFrames || 0) / 60).toFixed(1),
          p1: meta.p1,
          p2: meta.p2,
          stakeReais: ((meta.stakeCents || 0) / 100).toFixed(2),
          winnerId: meta.winnerId,
          totalFrames: meta.totalFrames,
          desyncDetected: meta.desyncDetected,
          persistent: true,
        });
      }
    } catch {}
    return list.sort((a, b) =>
      String(b.startTime).localeCompare(String(a.startTime)),
    );
  }
}

export const replayEngine = new ReplayEngine();
