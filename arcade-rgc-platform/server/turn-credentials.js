import crypto from "node:crypto";

/**
 * Emite lista ICE para WebRTC.
 * - Sempre inclui HOSTED_ICE_SERVERS (JSON) se configurado.
 * - Se TURN_URLS + TURN_SECRET estiverem definidos, adiciona credencial
 *   efêmera no formato coturn REST (HMAC-SHA1), válida por TURN_TTL_SEC.
 * - Sem TURN configurado, cai no STUN público (lab/local).
 * Dinheiro real / PIX não entram aqui.
 */
export function mintIceServers(nowMs = Date.now()) {
  let staticServers = [];
  try {
    staticServers = JSON.parse(process.env.HOSTED_ICE_SERVERS || "[]");
    if (!Array.isArray(staticServers)) staticServers = [];
  } catch {
    staticServers = [];
  }

  const ttlSec = Math.max(60, Number(process.env.TURN_TTL_SEC) || 3600);
  const urls = String(process.env.TURN_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const secret = process.env.TURN_SECRET || "";

  const iceServers = [...staticServers];
  let ephemeral = false;

  if (urls.length && secret) {
    const expiry = Math.floor(nowMs / 1000) + ttlSec;
    const username = `${expiry}:arena`;
    const credential = crypto
      .createHmac("sha1", secret)
      .update(username)
      .digest("base64");
    iceServers.push({
      urls: urls.length === 1 ? urls[0] : urls,
      username,
      credential,
    });
    ephemeral = true;
  }

  if (!iceServers.length) {
    iceServers.push({ urls: "stun:stun.l.google.com:19302" });
  }

  return {
    iceServers,
    ttlSec,
    ephemeral,
    expiresAt: ephemeral
      ? new Date(Math.floor(nowMs / 1000) * 1000 + ttlSec * 1000).toISOString()
      : null,
  };
}

export default { mintIceServers };
