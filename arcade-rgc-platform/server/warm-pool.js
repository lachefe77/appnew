/**
 * Warm pool de workers hosted: pré-aquece N sessões stub/fábrica e reutiliza.
 * Em lab/testes a factory pode ser fixture; em produção seria HostedSession.
 */

export class WarmPool {
  constructor({
    size = Number(process.env.HOSTED_WARM_POOL) || 0,
    factory,
  } = {}) {
    this.size = Math.max(0, Number(size) || 0);
    this.factory = factory;
    this.idle = [];
    this.busy = new Set();
    this.started = false;
  }

  async start() {
    if (this.started || this.size <= 0 || typeof this.factory !== "function")
      return;
    this.started = true;
    for (let i = 0; i < this.size; i++) {
      const worker = await this.factory({ warm: true, index: i });
      if (worker?.warmReady) await worker.warmReady();
      this.idle.push(worker);
    }
  }

  async acquire(options = {}) {
    let worker = this.idle.pop();
    if (!worker) {
      if (typeof this.factory !== "function")
        throw new Error("Warm pool sem factory.");
      worker = await this.factory({ ...options, warm: false });
    } else if (typeof worker.bind === "function") {
      await worker.bind(options);
    }
    this.busy.add(worker);
    return worker;
  }

  async release(worker, { destroy = false } = {}) {
    if (!worker) return;
    this.busy.delete(worker);
    if (destroy || this.idle.length >= this.size) {
      await worker.stop?.().catch(() => {});
      return;
    }
    if (typeof worker.reset === "function") await worker.reset();
    this.idle.push(worker);
  }

  async drain() {
    const all = [...this.idle, ...this.busy];
    this.idle = [];
    this.busy.clear();
    await Promise.all(all.map((w) => w.stop?.().catch(() => {})));
    this.started = false;
  }

  stats() {
    return {
      size: this.size,
      idle: this.idle.length,
      busy: this.busy.size,
      started: this.started,
    };
  }
}
