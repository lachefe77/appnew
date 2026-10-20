/**
 * Latência percebida comando → imagem.
 * Cliente envia clientSentAt no PLAYER_INPUT; servidor ecoa em INPUT_ACK;
 * cliente marca frameDecodedAt e reporta LATENCY_SAMPLE.
 */

export function computeCommandToImageMs({
  clientSentAt,
  acceptedAt,
  frameDecodedAt,
}) {
  if (
    typeof clientSentAt !== "number" ||
    typeof frameDecodedAt !== "number" ||
    !(frameDecodedAt >= clientSentAt)
  )
    return null;
  return {
    commandToImageMs: frameDecodedAt - clientSentAt,
    serverAckLagMs:
      typeof acceptedAt === "number" ? Math.max(0, acceptedAt - clientSentAt) : null,
  };
}

export function latencyRollingStats(samples, { window = 30 } = {}) {
  const list = (samples || []).slice(-window).filter((s) => s?.commandToImageMs != null);
  if (!list.length) return { count: 0, p50: null, p95: null, last: null };
  const sorted = list.map((s) => s.commandToImageMs).sort((a, b) => a - b);
  const pct = (p) =>
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return {
    count: sorted.length,
    p50: pct(50),
    p95: pct(95),
    last: list[list.length - 1].commandToImageMs,
  };
}
