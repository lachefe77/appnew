import { sendAlert, alertOnHealthFailure } from "../server/alerts.js";

const target = process.argv[2] || "http://127.0.0.1:3001";
try {
  const response = await fetch(new URL("/health", target), {
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
  });
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data.status !== "ok" || data.reconciliation !== true)
    throw Error("Servidor indisponível ou conciliação financeira com falha.");
  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        status: data.status,
        version: data.version,
        activeMatches: data.activeMatches,
        onlineUsers: data.onlineUsers,
        reconciliation: data.reconciliation,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const reason = error.message;
  console.error(JSON.stringify({ status: "failed", reason }));
  const alertResult = await alertOnHealthFailure({
    ok: false,
    status: "failed",
    reason,
    reconciliation: false,
  });
  if (alertResult.sent)
    console.error(JSON.stringify({ alert: "sent", ...alertResult }));
  else if (!alertResult.skipped)
    console.error(JSON.stringify({ alert: "failed", ...alertResult }));
  process.exitCode = 1;
}

// Re-export helpers for tests (side-effect free when imported? — this file is a CLI).
void sendAlert;
