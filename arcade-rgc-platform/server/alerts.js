/**
 * Alertas externos (Slack/Telegram webhook) a partir de falhas de health.
 * Sem ALERT_WEBHOOK_URL: no-op (não falha o processo).
 */

export async function sendAlert(
  payload,
  {
    url = process.env.ALERT_WEBHOOK_URL || "",
    fetchImpl = globalThis.fetch,
    timeoutMs = 5000,
  } = {},
) {
  if (!url) {
    return { sent: false, skipped: true, reason: "ALERT_WEBHOOK_URL unset" };
  }
  const body =
    typeof payload === "string"
      ? { text: payload }
      : {
          text:
            payload.text ||
            `[Arena] ${payload.status || "alert"}: ${payload.reason || ""}`,
          ...payload,
        };
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { sent: res.ok, status: res.status, skipped: false };
  } catch (error) {
    return {
      sent: false,
      skipped: false,
      error: error.message || String(error),
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Avalia resultado de /health e dispara alerta se falhou.
 * healthResult: { ok:boolean, status?, reconciliation?, reason? }
 */
export async function alertOnHealthFailure(healthResult, options) {
  if (healthResult?.ok === true && healthResult?.reconciliation !== false)
    return { sent: false, skipped: true, reason: "healthy" };
  return sendAlert(
    {
      text: `[Arena Arcade] health FAILED: ${
        healthResult?.reason || healthResult?.status || "unknown"
      }`,
      status: "failed",
      reason: healthResult?.reason || "health check failed",
      reconciliation: healthResult?.reconciliation,
      at: new Date().toISOString(),
    },
    options,
  );
}
