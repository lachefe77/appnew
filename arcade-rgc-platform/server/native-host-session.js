/**
 * NativeHostSession — Host Bot sem Chrome/Playwright.
 * Fala JSONL com scripts/native-host-worker.js (stub) ou HOST_BOT_BIN real.
 * Mesma superfície pública que HostedSession para platform.js.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { Kof2002Observer } from "./kof2002-observer.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function defaultBotCommand() {
  const bin = process.env.HOST_BOT_BIN;
  if (bin) {
    const args = (process.env.HOST_BOT_ARGS || "")
      .split(/\s+/)
      .filter(Boolean);
    return { command: bin, args };
  }
  return {
    command: process.execPath,
    args: [path.join(root, "scripts/native-host-worker.js")],
  };
}

export class NativeHostSession {
  constructor({
    onSignal,
    onSample,
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
    this.engine = "native";
  }

  send(cmd, extra = {}) {
    if (!this.child?.stdin?.writable) {
      return Promise.reject(Error("Host Bot indisponível."));
    }
    this.child.stdin.write(JSON.stringify({ cmd, ...extra }) + "\n");
    return Promise.resolve();
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
    const { command, args } = defaultBotCommand();
    this.child = spawn(command, args, {
      cwd: process.env.HOST_BOT_WORKDIR
        ? path.resolve(root, process.env.HOST_BOT_WORKDIR)
        : root,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HOST_BOT_ROLE: "worker" },
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
    });
    const ev = await ready;
    this.started = true;
    this.manifest = ev.manifest || { engine: "native-stub" };
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
    return this.enqueue(() => this.send("input", { slot, button, value }));
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

  /** Stub: evidência textual até haver framebuffer/ffmpeg. */
  async captureEvidence(matchId) {
    return {
      kind: "native-stub",
      matchId: String(matchId),
      at: Date.now(),
      sample: this.lastSample,
      note: "Screenshot nativo entra na fase 2 (framebuffer/ffmpeg).",
    };
  }

  /** Lab/testes: injeta resultado no worker stub. */
  async injectFixtureResult(winnerSlot) {
    return this.send("injectResult", { winnerSlot });
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
