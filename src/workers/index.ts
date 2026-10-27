import { Worker } from "bullmq";
import IORedis from "ioredis";
import { config } from "../server/config";
import { sweepDueJobs } from "../server/jobs";
import { runWatchdog } from "../server/watchdog";

async function main() {
  console.log("[nh] worker de filas, lembrete de PIX e watchdog");
  if (config.redisUrl) {
    const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
    connection.on("error", (error) => console.error("[nh] redis worker", error.message));
    const handler = async (job: { data: { outboxId?: string } }) => {
      if (!job.data.outboxId) return;
      const { runOutboxById } = await import("../server/jobs");
      await runOutboxById(job.data.outboxId);
    };
    new Worker("fulfillment-queue", handler, { connection, concurrency: 3 });
    new Worker("abandoned-pix-queue", handler, { connection: connection.duplicate(), concurrency: 2 });
  } else {
    console.log("[nh] REDIS_URL vazio. A varredura do Postgres segue sozinha.");
  }

  const tick = async () => {
    try {
      await sweepDueJobs();
    } catch (error) {
      console.error("[nh] varredura", error);
    }
  };
  await tick();
  setInterval(tick, 5_000);

  if (config.watchdogIntervalMs > 0) {
    setInterval(() => {
      runWatchdog().catch((error) => console.error("[nh] watchdog", error));
    }, config.watchdogIntervalMs);
  }
}

void main();
