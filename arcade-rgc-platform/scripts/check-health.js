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
  console.error(JSON.stringify({ status: "failed", reason: error.message }));
  process.exitCode = 1;
}
