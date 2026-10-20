// Profile for the pinned EmulatorJS 4.2.3 FBNeo legacy build. The RAM location
// is specific to its serialization layout, NOT a generic FBNeo ABI.
// Address references: fightcadeorg/fightcade-detectors/kof2002.inf and
// peon2/fbneo-training-mode/games/kof2002/kof2002.lua. Runtime hashes are pinned.
export const kofProfile = Object.freeze({
  id: "kof2002-ejs423-legacy-v1",
  stateBytes: 414144,
  ramOffset: 0x3064c,
  health: [0x8239, 0x8439],
  timer: 0xa7d3,
  wins: [0xdab6, 0xdab8],
});
export function readKofSample(state) {
  if (
    !(state instanceof Uint8Array) ||
    state.length !== kofProfile.stateBytes ||
    new TextDecoder().decode(state.subarray(0, 7)) !== "RASTATE" ||
    new TextDecoder().decode(state.subarray(8, 12)) !== "MEM "
  )
    throw Error(
      "Layout de memória do core não reconhecido; resultado bloqueado.",
    );
  const read = (address) => state[kofProfile.ramOffset + (address ^ 1)];
  // Fightcade detector offsets address the raw scanned "68K RAM" area; Lua
  // CPU addresses for health use byte-swapped 68000 reads instead.
  const raw = (address) => state[kofProfile.ramOffset + address];
  return {
    frame: new DataView(
      state.buffer,
      state.byteOffset,
      state.byteLength,
    ).getUint32(16, true),
    health: kofProfile.health.map(read),
    timer: raw(kofProfile.timer),
    wins: kofProfile.wins.map(raw),
  };
}

/**
 * Sample já decodificado (Host Bot Lua/JSON). Não usa layout RASTATE/EJS.
 * Endereços de origem: peon2/fbneo-training-mode + fightcade detectors.
 */
export function normalizeSample(raw) {
  if (!raw || typeof raw !== "object")
    throw Error("Sample de estado inválido; resultado bloqueado.");
  const frame = Number(raw.frame);
  if (!Number.isFinite(frame) || frame < 0)
    throw Error("Frame de sample inválido; resultado bloqueado.");
  const health = [Number(raw.health?.[0]), Number(raw.health?.[1])];
  const wins = [Number(raw.wins?.[0]), Number(raw.wins?.[1])];
  const timer = Number(raw.timer);
  if (health.some((h) => !Number.isFinite(h)) || wins.some((w) => !Number.isFinite(w)) || !Number.isFinite(timer))
    throw Error("Campos de sample incompletos; resultado bloqueado.");
  return {
    frame: Math.floor(frame),
    health: health.map((h) => h & 0xff),
    timer: timer & 0xff,
    wins: wins.map((w) => w & 0xff),
  };
}

export class Kof2002Observer {
  constructor() {
    this.armed = false;
    this.started = false;
    this.finished = false;
    this.starts = new Set();
    this.lastFrame = -1;
    this.samples = 0;
    this.candidate = null;
    this.baseline = null;
    this.timeOverSince = null;
  }
  arm() {
    this.armed = true;
  }
  startPressed(slot) {
    this.starts.add(slot);
  }
  /** Reinicia o detector entre games de uma série Bo3/Bo5 sem zerar o relógio. */
  resetForNextGame() {
    this.finished = false;
    this.started = false;
    this.starts.clear();
    this.candidate = null;
    this.baseline = null;
    this.timeOverSince = null;
    this.armed = false;
  }
  /** Chrome/EmulatorJS: snapshot RASTATE → sample. */
  observe(state) {
    return this.observeSample(readKofSample(state));
  }
  /**
   * Host Bot nativo: sample JSON pré-decodificado (Lua bridge).
   * Mesma máquina de estados que observe(); não depende de RASTATE.
   */
  observeSample(raw) {
    const sample = normalizeSample(raw);
    this.samples++;
    if (sample.frame < this.lastFrame)
      throw Error("Relógio do core retrocedeu; resultado bloqueado.");
    if (sample.frame === this.lastFrame) return { sample };
    this.lastFrame = sample.frame;
    if (this.finished || !this.armed) return { sample };
    if (!this.started) {
      const validTimer =
        sample.timer > 0 && sample.timer <= 0x60 && (sample.timer & 15) <= 9;
      if (
        this.starts.size === 2 &&
        validTimer &&
        sample.health.every((h) => h > 0 && h <= 0x67) &&
        sample.wins.every((w) => w === 0)
      ) {
        this.started = true;
        this.baseline = [...sample.wins];
        this.timeOverSince = null;
        return { sample, event: "COMBAT_OBSERVED" };
      }
      return { sample };
    }
    const delta = sample.wins.map((w, i) => w - this.baseline[i]);
    if (delta.some((n) => n < 0 || n > 1) || delta.every((n) => n === 1)) {
      return {
        sample,
        event: "INCOHERENT_WINS",
        needsReview: true,
        reason:
          "Contadores de vitória inconsistentes (possível double KO / empate incoerente); revisão necessária.",
      };
    }

    // Round intermediário: ambos com vida 0 e sem incremento oficial de wins.
    if (
      sample.health.every((h) => h === 0) &&
      delta.every((n) => n === 0)
    ) {
      return { sample, event: "DOUBLE_KO_ROUND" };
    }

    let winnerSlot = delta[0] === 1 ? 1 : delta[1] === 1 ? 2 : null;

    // Time-over: timer zera e o core ainda não atualizou o contador de wins.
    // Após ~90 frames (~1.5s @60), usa health como desempate estável.
    if (!winnerSlot && sample.timer === 0) {
      if (this.timeOverSince == null) this.timeOverSince = sample.frame;
      const held = sample.frame - this.timeOverSince;
      const [h1, h2] = sample.health;
      if (held >= 90) {
        if (h1 === h2) {
          return {
            sample,
            event: "TIME_OVER_DRAW",
            needsReview: true,
            reason:
              "Time-over com vida empatada; evidência insuficiente para liquidar automaticamente.",
          };
        }
        winnerSlot = h1 > h2 ? 1 : 2;
        return this._confirmWinner(sample, winnerSlot, "time-over-health");
      }
      return { sample, event: "TIME_OVER_PENDING" };
    } else {
      this.timeOverSince = null;
    }

    if (!winnerSlot) {
      this.candidate = null;
      return { sample };
    }
    return this._confirmWinner(sample, winnerSlot, "win-counter");
  }
  _confirmWinner(sample, winnerSlot, source) {
    if (this.candidate?.winnerSlot === winnerSlot) this.candidate.count++;
    else this.candidate = { winnerSlot, count: 1, firstFrame: sample.frame, source };
    if (
      this.candidate.count >= 3 &&
      sample.frame - this.candidate.firstFrame >= 30
    ) {
      this.finished = true;
      return {
        sample,
        result: {
          winnerSlot,
          profile: kofProfile.id,
          frame: sample.frame,
          wins: sample.wins,
          health: sample.health,
          timer: sample.timer,
          source: "private-server-memory",
          detection: this.candidate.source || source,
        },
      };
    }
    return { sample };
  }
}
