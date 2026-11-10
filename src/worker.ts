import { retryAlerts } from "@/server/alerts"
import { refreshRealFeeds } from "@/server/feeds/refresh"

async function cycle() {
  const started = Date.now()
  await refreshRealFeeds(true)
  await retryAlerts().catch(() => undefined)
  const wait = Math.max(5_000, 20_000 - (Date.now() - started))
  setTimeout(() => {
    void cycle()
  }, wait)
}

void cycle()
