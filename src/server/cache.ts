import IORedis from "ioredis";
import { config } from "./config";

const memory = new Map<string, { value: string; exp: number }>();
let client: IORedis | null = null;

function redis() {
  if (!config.redisUrl) return null;
  if (!client) {
    client = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    client.on("error", () => {
      /* cache é opcional; a memória segura o processo */
    });
  }
  return client;
}

export async function cacheGet(key: string) {
  const hit = memory.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  try {
    const store = redis();
    if (!store) return null;
    if (store.status === "wait") await store.connect();
    return await store.get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds: number) {
  memory.set(key, { value, exp: Date.now() + ttlSeconds * 1000 });
  try {
    const store = redis();
    if (!store) return;
    if (store.status === "wait") await store.connect();
    await store.set(key, value, "EX", ttlSeconds);
  } catch {
    /* memória já guardou */
  }
}
