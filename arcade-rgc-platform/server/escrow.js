/**
 * Cálculo de rake da plataforma.
 * Carteiras e partidas vivem exclusivamente em finance.js / SQLite.
 * Este módulo não guarda saldo em memória.
 */

const VIP_DISCOUNT = Object.freeze({
  CRISTAL: -0.05,
  DIAMANTE: -0.03,
  OURO: -0.01,
  BRONZE: 0,
});

/** Fração do pote (0–1) conforme stake por jogador e VIP. */
export function calculateRake(stakePerPlayerCents, vipLevel = "BRONZE") {
  const discount = VIP_DISCOUNT[vipLevel] || 0;
  let base;
  if (stakePerPlayerCents <= 200) base = 0.15;
  else if (stakePerPlayerCents <= 2000) base = 0.1;
  else base = 0.08;
  return Math.max(0.03, base + discount);
}

/**
 * Rake em centavos para o pote (2 × stake).
 * Se a sala define rakePercent (0–20), ele prevalece sobre a tabela VIP.
 */
export function rakeCentsForPot(
  stakePerPlayerCents,
  { vipLevel = "BRONZE", roomRakePercent } = {},
) {
  if (!stakePerPlayerCents) return 0;
  const pot = stakePerPlayerCents * 2;
  if (
    Number.isFinite(roomRakePercent) &&
    roomRakePercent >= 0 &&
    roomRakePercent <= 20
  ) {
    return Math.round(pot * (roomRakePercent / 100));
  }
  return Math.round(pot * calculateRake(stakePerPlayerCents, vipLevel));
}
