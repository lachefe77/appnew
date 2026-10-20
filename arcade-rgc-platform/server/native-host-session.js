/**
 * NativeHostSession — Host Bot sem Chrome/Playwright.
 * Fala JSONL com scripts/native-host-worker.js (stub) ou HOST_BOT_BIN real.
 * Fase 1: samples JSON → observeSample (sem RASTATE/EmulatorJS).
 * Mesma superfície pública que HostedSession para platform.js.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { Kof2002Observer } from "./kof2002-observer.js";
import { buildNativeHostLaunch } from "./native-host-launcher.js";
import { mapArenaInput } from "./native-input-map.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export class NativeHostSession {
  constructor({
    onSignal,
    onSample,
    onFrame,
    onFailure,
    onMetrics,
    onResult,
    onObservation,
    onPeer,
    onProgress,
    iceServers = [],
    matchId = null,
  } = {}) {
    Object.assign(this, {
      onSignal,
      onSample,
      onFrame,
      onFailure,
      onMetrics,
      onResult,
      onObservation,
      onPeer,
      onProgress,
      iceServers,
      matchId,
    });
    this.observer = new Kof2002Observer();
    this.closed = false;
    this.started = false;
    this.failed = false;
    this.pending = 0;
    this.chain = Promise.resolve();
    this.child = null;
    this.lastSample = null;
    this.lastMappedInput = null;
    this.lastExternalCount = 0;
    this.engine = "native";
    this.launch = null;
  }

  send(cmd, extra = {}) {
    if (!this.child?.stdin?.writable) {
      return Promise.reject(Error("Host Bot indisponível."));
    }
    this.child.stdin.write(JSON.stringify({ cmd, ...extra }) + "\n");
    return Promise.resolve();
  }

  applySample(raw) {
    if (this.closed) return;
    try {
      const observation = this.observer.observeSample(raw);
      this.lastSample = observation.sample;
      this.onSample?.(observation.sample);
      if (observation.needsReview) {
        this.send("pause").catch(() => {});
        this.fail(observation.reason || observation.event);
        return;
      }
      if (observation.event) this.onObservation?.(observation);
      if (observation.result) {
        this.send("pause").catch(() => {});
        this.onResult?.(observation.result);
      }
    } catch (error) {
      this.fail(error.message || String(error));
    }
  }

  handleEvent(ev) {
    if (this.closed || !ev?.event) return;
    switch (ev.event) {
      case "progress":
        this.onProgress?.(ev.stage);
        break;
      case "peer":
        this.onPeer?.(ev.slot, ev.state);
        break;
      case "ready":
        this.started = true;
        this.manifest = ev.manifest || { engine: "native" };
        break;
      case "sample":
        this.applySample(ev.sample);
        break;
      case "signal":
        this.onSignal?.(ev.slot, ev.signal);
        break;
      case "frame":
        this.lastExternalCount = ev.externalCount ?? this.lastExternalCount;
        this.onFrame?.(ev);
        break;
      case "observation":
        this.onObservation?.(ev.observation || ev);
        break;
      case "result":
        this.onResult?.(ev.result);
        break;
      case "metrics":
        this.onMetrics?.(ev.metrics);
        break;
      case "failure":
        this.fail(ev.message || "Falha do Host Bot.");
        break;
      case "hello":
      case "stopped":
        break;
      default:
        break;
    }
  }

  async start() {
    if (this.closed) throw Error("Sessão encerrada.");
    this.launch = buildNativeHostLaunch();
    const { command, args, workdir, env: launchEnv } = this.launch;

    // Fase 1 lab: sempre sobe o worker Node (stub). HOST_BOT_BIN real
    // entra via env no worker / launcher docs; vídeo = Fase 2.
    // Se o operador apontar HOST_BOT_BIN para o próprio worker, respeitamos.
    const useWorker =
      this.launch.mode === "stub" ||
      String(process.env.HOST_BOT_USE_WORKER || "1") !== "0";

    const spawnCmd = useWorker
      ? process.execPath
      : command;
    const spawnArgs = useWorker
      ? [path.join(root, "scripts/native-host-worker.js")]
      : args;

    this.child = spawn(spawnCmd, spawnArgs, {
      cwd: useWorker
        ? root
        : workdir ||
          (process.env.HOST_BOT_WORKDIR
            ? path.resolve(root, process.env.HOST_BOT_WORKDIR)
            : root),
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        HOST_BOT_ROLE: "worker",
        HOST_BOT_MODE: launchEnv?.HOST_BOT_MODE || "stub",
        HOST_BOT_LUA: launchEnv?.HOST_BOT_LUA || "",
        HOST_BOT_LAUNCH_MODE: this.launch.mode,
        HOST_BOT_LAUNCH_BIN: command,
        HOST_BOT_LAUNCH_ARGS: JSON.stringify(args),
      },
      windowsHide: true,
    });
    this.child.on("exit", (code) => {
      if (!this.closed && code !== 0)
        this.fail("Host Bot encerrou (código " + code + ").");
    });
    this.child.stderr?.on("data", (buf) => {
      const text = String(buf);
      if (text.trim()) console.error("[HOST_BOT]", text.trim());
    });

    const rl = createInterface({ input: this.child.stdout });
    rl.on("line", (line) => {
      try {
        this.handleEvent(JSON.parse(line));
      } catch {
        /* ignore partial */
      }
    });
    this._rl = rl;

    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Timeout ao iniciar Host Bot.")),
        Number(process.env.HOST_BOT_START_MS) || 60000,
      );
      const onLine = (line) => {
        try {
          const ev = JSON.parse(line);
          if (ev.event === "ready") {
            clearTimeout(timer);
            rl.off("line", onLine);
            resolve(ev);
          } else if (ev.event === "failure") {
            clearTimeout(timer);
            rl.off("line", onLine);
            reject(Error(ev.message || "Host Bot falhou no start."));
          }
        } catch {
          /* keep waiting */
        }
      };
      rl.on("line", onLine);
    });

    await this.send("start", {
      matchId: this.matchId,
      iceServers: this.iceServers,
      launch: {
        mode: this.launch.mode,
        command,
        args,
      },
    });
    const ev = await ready;
    this.started = true;
    this.manifest = {
      ...(ev.manifest || { engine: "native-stub" }),
      launchMode: this.launch.mode,
      phase: ev.manifest?.phase ?? 2,
    };
    return { manifest: this.manifest };
  }

  enqueue(action) {
    if (this.closed || !this.started)
      return Promise.reject(Error("Execução oficial indisponível."));
    if (this.pending >= 256) {
      this.fail("Fila de execução oficial excedida.");
      return Promise.reject(Error("Fila excedida."));
    }
    this.pending++;
    const work = this.chain.then(() => {
      if (!this.closed) return action();
    });
    this.chain = work.catch(() => {}).finally(() => this.pending--);
    return work;
  }

  signal(slot, signal) {
    return this.enqueue(() => this.send("signal", { slot, signal }));
  }

  input(slot, button, value) {
    if (button === 3 && value === 1) this.observer.startPressed(slot);
    this.lastMappedInput = mapArenaInput(slot, button, value);
    return this.enqueue(() =>
      this.send("input", {
        slot,
        button,
        value,
        mapped: this.lastMappedInput,
      }),
    );
  }

  pause() {
    return this.enqueue(() => this.send("pause"));
  }

  resume() {
    this.observer.arm();
    return this.enqueue(() => this.send("resume"));
  }

  resetObserver() {
    this.observer.resetForNextGame();
    this.send("resetObserver").catch(() => {});
  }

  /** Evidência Fase 2: PPM 320×240 via frame source (framebuffer FBNeo depois). */
  async captureEvidence(matchId) {
    const fs = await import("node:fs");
    const dir = path.join(root, "data", "evidence", String(matchId));
    fs.mkdirSync(dir, { recursive: true });
    const name = `frame-${Date.now()}.ppm`;
    const filePath = path.join(dir, name);
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Timeout na evidência nativa.")),
        5000,
      );
      const onLine = (line) => {
        try {
          const ev = JSON.parse(line);
          if (ev.event === "evidence" && ev.path === filePath) {
            clearTimeout(timer);
            this._rl?.off("line", onLine);
            resolve(ev);
          }
        } catch {
          /* keep waiting */
        }
      };
      this._rl?.on("line", onLine);
    });
    await this.send("captureEvidence", { path: filePath });
    await done;
    return {
      kind: "native-phase2",
      matchId: String(matchId),
      at: Date.now(),
      sample: this.lastSample,
      mappedInput: this.lastMappedInput,
      path: filePath,
      note: "PPM lab 320p; framebuffer FBNeo/ffmpeg na próxima etapa.",
    };
  }

  /** Lab/testes: injeta resultado no worker stub. */
  async injectFixtureResult(winnerSlot) {
    return this.send("injectResult", { winnerSlot });
  }

  /** Lab/testes: injeta sample sintético (observeSample sem FBNeo). */
  async injectSample(sample) {
    return this.send("injectSample", { sample });
  }

  /**
   * Injeta framebuffer externo (RGB24/I420) no encode WebRTC.
   * @param {{ width?: number, height?: number, format?: string, data: string|Buffer }} frame
   *   data: base64 string ou Buffer (Buffer vira base64 no IPC).
   */
  async injectFrame(frame) {
    const payload = { ...frame };
    if (Buffer.isBuffer(payload.data)) {
      payload.data = payload.data.toString("base64");
    }
    return this.send("injectFrame", { frame: payload });
  }

  fail(message) {
    if (!this.closed && !this.failed) {
      this.failed = true;
      this.onFailure?.(message);
    }
  }

  async stop() {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.send("stop");
    } catch {
      /* already dead */
    }
    this._rl?.close();
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
      setTimeout(() => {
        try {
          this.child?.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 2000).unref?.();
    }
  }
}
