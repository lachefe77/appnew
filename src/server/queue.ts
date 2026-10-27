import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "./config";

let connection: IORedis | null = null;

function bull() {
  if (!config.redisUrl) return null;
  if (!connection) {
    connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
    connection.on("error", (error) => {
      console.error("[nh] redis", error.message);
    });
  }
  return connection;
}

export async function wake(queueName: string, outboxId: string, delayMs: number) {
  const connection = bull();
  if (connection) {
    const queue = new Queue(queueName, { connection });
    try {
      await queue.add(
        "run",
        { outboxId },
        {
          jobId: outboxId,
          delay: Math.max(0, delayMs),
          attempts: 5,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: 1000,
          removeOnFail: 500,
        },
      );
    } catch (error) {
      console.error("[nh] não enfileirou", error instanceof Error ? error.message : error);
    } finally {
      await queue.close();
    }
  }
  if (delayMs <= 0 && config.inlineJobs) {
    const { runOutboxById } = await import("./jobs");
    try {
      await runOutboxById(outboxId);
    } catch (error) {
      console.error("[nh] execução imediata", error instanceof Error ? error.message : error);
    }
  }
}

async function withQueue(action: (queue: Queue) => Promise<void>) {
  const connection = bull();
  if (!connection) return;
  const queue = new Queue("fulfillment-queue", { connection });
  try {
    await action(queue);
  } finally {
    await queue.close();
  }
}

export async function pauseBullQueue() {
  await withQueue((queue) => queue.pause());
}

export async function resumeBullQueue() {
  await withQueue((queue) => queue.resume());
}
