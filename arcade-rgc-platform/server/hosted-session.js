import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "playwright-core";
import { verifyHostedAssets, projectRoot } from "./hosted-assets.js";
import { Kof2002Observer } from "./kof2002-observer.js";

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".data": "application/octet-stream",
};
export class HostedSession {
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
  }) {
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
    });
    this.observer = new Kof2002Observer();
    this.closed = false;
    this.started = false;
    this.pending = 0;
    this.chain = Promise.resolve();
  }
  async start() {
    this.onProgress?.("assets");
    const assets = verifyHostedAssets();
    this.manifest = assets.manifest;
    const secret = crypto.randomBytes(32).toString("hex");
    const permitted = new Map([
      ["/emulator.html", path.join(projectRoot, "public/emulator.html")],
      ["/rom-check.js", path.join(projectRoot, "public/rom-check.js")],
      [
        "/emulator-runtime.js",
        path.join(projectRoot, "public/emulator-runtime.js"),
      ],
      ["/hosted-worker.js", path.join(projectRoot, "server/hosted-worker.js")],
    ]);
    for (const name of assets.runtimeFiles)
      permitted.set(
        "/emulatorjs/data/" + name,
        path.join(projectRoot, "public/emulatorjs/data", name),
      );
    this.http = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (
        req.method !== "GET" ||
        req.headers.host !== this.authority ||
        (req.headers.origin && req.headers.origin !== this.origin)
      ) {
        res.writeHead(403);
        return res.end();
      }
      const initial =
        url.pathname === "/emulator.html" &&
        url.searchParams.get("token") === secret;
      if (!initial && req.headers.cookie !== `worker=${secret}`) {
        res.writeHead(403);
        return res.end();
      }
      const file = permitted.get(url.pathname);
      if (!file) {
        res.writeHead(404);
        return res.end();
      }
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (initial)
        res.setHeader(
          "Set-Cookie",
          `worker=${secret}; HttpOnly; SameSite=Strict; Path=/`,
        );
      res.setHeader(
        "Content-Type",
        mime[path.extname(file)] || "application/octet-stream",
      );
      fs.createReadStream(file)
        .on("error", () => res.destroy())
        .pipe(res);
    });
    await new Promise((resolve, reject) => {
      this.http.once("error", reject);
      this.http.listen(0, "127.0.0.1", resolve);
    });
    this.authority = "127.0.0.1:" + this.http.address().port;
    this.origin = "http://" + this.authority;
    try {
      this.onProgress?.("runtime");
      this.browser = await chromium.launch({
        headless: true,
        ...(process.env.HOSTED_BROWSER_PATH
          ? { executablePath: process.env.HOSTED_BROWSER_PATH }
          : { channel: process.platform === "win32" ? "msedge" : "chromium" }),
        args: [
          "--autoplay-policy=no-user-gesture-required",
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding",
        ],
      });
      if (this.closed) {
        await this.browser.close();
        throw Error("Sessão encerrada durante preparação.");
      }
      const context = await this.browser.newContext({
        viewport: { width: 640, height: 480 },
        serviceWorkers: "block",
        acceptDownloads: false,
      });
      this.page = await context.newPage();
      this.cdp = await context.newCDPSession(this.page);
      await this.cdp.send("Performance.enable");
      await context.route("**/*", (route) => {
        const url = route.request().url();
        return url.startsWith(this.origin + "/") ||
          url.startsWith("blob:") ||
          url.startsWith("data:")
          ? route.continue()
          : route.abort();
      });
      await this.page.exposeBinding("hostedEvent", ({ page }, event) => {
        if (page !== this.page || this.closed) return;
        if (event.type === "signal") this.onSignal(event.slot, event.signal);
        else if (event.type === "peer") this.onPeer?.(event.slot, event.state);
      });
      this.page.on("crash", () =>
        this.fail("Processo do emulador interrompido."),
      );
      this.browser.on("disconnected", () => {
        if (!this.closed) this.fail("Execução oficial desconectada.");
      });
      await this.page.goto(this.origin + "/emulator.html?token=" + secret);
      // Fixed options are installed inside the private context before the core loads.
      await this.page.evaluate(() => {
        let options = {};
        Object.defineProperty(window, "EJS_defaultOptions", {
          configurable: false,
          get: () => options,
          set: (base) => {
            options = {
              ...base,
              "fbneo-cpu-speed-adjust": "100%",
              "fbneo-allow-patched-romsets": "disabled",
              "fbneo-diagnostic-input": "None",
              "fbneo-hiscores": "disabled",
            };
          },
        });
      });
      await this.page
        .locator("#rom")
        .setInputFiles(assets.files["kof2002.zip"]);
      await this.page
        .locator("#bios")
        .setInputFiles(assets.files["neogeo.zip"]);
      await this.page.locator("#load").click();
      this.onProgress?.("boot");
      await this.page.waitForFunction(() => !!window.arenaEmulator, null, {
        timeout: 120000,
      });
      await this.page.addScriptTag({ url: this.origin + "/hosted-worker.js" });
      await this.page.evaluate(
        (options) => {
          window.hostedWorker = window.createHostedWorker(options);
        },
        { iceServers: this.iceServers },
      );
      await this.page.waitForFunction(
        () => EJS_emulator.gameManager.getFrameNum() > 650,
        null,
        { timeout: 60000 },
      );
      // Cabinet credits are seeded by the server, never bought via player input.
      this.onProgress?.("credits");
      for (let i = 0; i < 4; i++) {
        await this.page.evaluate(() => hostedWorker.input(1, 2, 1));
        await new Promise((r) => setTimeout(r, 120));
        await this.page.evaluate(() => hostedWorker.input(1, 2, 0));
        await new Promise((r) => setTimeout(r, 120));
      }
      await this.page.evaluate(() => hostedWorker.pause());
      this.started = true;
      this.monitor = setInterval(
        () => this.sample().catch((error) => this.fail(error.message)),
        500,
      );
      this.monitor.unref();
      return { manifest: this.manifest };
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  async sample() {
    if (this.closed || this.sampling) return;
    this.sampling = true;
    try {
      const value = await this.page.evaluate(() => {
        const state = EJS_emulator.gameManager.getState();
        let binary = "";
        for (let i = 0; i < state.length; i += 8192)
          binary += String.fromCharCode(...state.subarray(i, i + 8192));
        return btoa(binary);
      });
      const state = new Uint8Array(Buffer.from(value, "base64"));
      await this.onSample?.(state);
      const observation = this.observer.observe(state);
      this.lastSample = observation.sample;
      if (observation.needsReview) {
        await this.pause().catch(() => {});
        this.fail(observation.reason || observation.event);
        return;
      }
      if (observation.event) this.onObservation?.(observation);
      if (observation.result) {
        await this.pause();
        this.onResult?.(observation.result);
      }
      if (Date.now() - (this.lastMetrics || 0) > 2000) {
        this.lastMetrics = Date.now();
        const metrics = await this.page.evaluate(() => hostedWorker.metrics());
        const performance = Object.fromEntries(
          (await this.cdp.send("Performance.getMetrics")).metrics.map((m) => [
            m.name,
            m.value,
          ]),
        );
        const previous = this.previousPerformance;
        metrics.workerMainThreadBusyPercent = previous
          ? Math.round(
              ((performance.TaskDuration - previous.TaskDuration) /
                (performance.Timestamp - previous.Timestamp)) *
                100,
            )
          : null;
        metrics.workerJsHeapBytes = performance.JSHeapUsedSize;
        this.previousPerformance = performance;
        this.onMetrics?.(metrics);
      }
    } finally {
      this.sampling = false;
    }
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
    return this.enqueue(() =>
      this.page.evaluate(
        ({ slot, signal }) => hostedWorker.signal(slot, signal),
        { slot, signal },
      ),
    );
  }
  input(slot, button, value) {
    if (button === 3 && value === 1) this.observer.startPressed(slot);
    return this.enqueue(() =>
      this.page.evaluate(
        ({ slot, button, value }) => hostedWorker.input(slot, button, value),
        { slot, button, value },
      ),
    );
  }
  pause() {
    return this.enqueue(() => this.page.evaluate(() => hostedWorker.pause()));
  }
  resume() {
    this.observer.arm();
    return this.enqueue(() => this.page.evaluate(() => hostedWorker.resume()));
  }
  /** Entre games de série: rearm o detector sem derrubar o worker. */
  resetObserver() {
    this.observer.resetForNextGame();
  }
  /**
   * Evidência mínima para revisão: screenshot PNG via CDP.
   * Arquivo privado em data/evidence/<matchId>/ (nunca servido em /public).
   */
  async captureEvidence(matchId) {
    if (this.closed || !this.cdp || !this.page) return null;
    const { data } = await this.cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    });
    const dir = path.join(projectRoot, "data", "evidence", String(matchId));
    fs.mkdirSync(dir, { recursive: true });
    const name = `frame-${Date.now()}.png`;
    const file = path.join(dir, name);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    let sample = this.lastSample || null;
    try {
      if (!sample) await this.sample();
      sample = this.lastSample || sample;
    } catch {
      /* sample best-effort */
    }
    return {
      kind: "screenshot",
      path: file,
      relativePath: path.relative(projectRoot, file),
      at: Date.now(),
      sample,
    };
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
    clearInterval(this.monitor);
    await this.browser?.close().catch(() => {});
    if (this.http) await new Promise((resolve) => this.http.close(resolve));
  }
}
