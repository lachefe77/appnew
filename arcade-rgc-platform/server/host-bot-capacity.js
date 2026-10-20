/**
 * Estimativa de densidade de X1 hosted (números de engenharia, não benchmark).
 * Calibrar com prova de carga na VPS real.
 */

/** RAM típica por partida (MB), por engine. */
export const RAM_MB_PER_MATCH = Object.freeze({
  chrome: 700,
  // FBNeo/libretro headless + encode 320p30 leve (ordem de grandeza pós-Chrome).
  native: 220,
});

/** Fração de 1 vCPU por partida sob encode. */
export const VCPU_PER_MATCH = Object.freeze({
  chrome: 0.9,
  // Encode compartilha pipeline; calibrar na VPS (meta ~20 em 5 vCPU).
  native: 0.2,
});

/**
 * @param {{ ramMb: number, vcpu: number, engine?: 'chrome'|'native', osReserveMb?: number, headroom?: number }} opts
 * @returns {{ maxByRam: number, maxByCpu: number, recommended: number, engine: string }}
 */
export function estimateHostedCapacity({
  ramMb,
  vcpu,
  engine = "native",
  osReserveMb = 1536,
  headroom = 0.25,
} = {}) {
  const eng = engine === "chrome" ? "chrome" : "native";
  const perRam = RAM_MB_PER_MATCH[eng];
  const perCpu = VCPU_PER_MATCH[eng];
  const usableRam = Math.max(0, Number(ramMb) - Number(osReserveMb));
  const maxByRam = Math.floor((usableRam * (1 - headroom)) / perRam);
  const maxByCpu = Math.floor((Number(vcpu) * (1 - headroom)) / perCpu);
  const recommended = Math.max(0, Math.min(maxByRam, maxByCpu));
  return {
    engine: eng,
    maxByRam: Math.max(0, maxByRam),
    maxByCpu: Math.max(0, maxByCpu),
    recommended,
    notes:
      eng === "native"
        ? "Calibrar após carga real; encode e core dominam."
        : "Chrome inviável para densidade; use native em produção leve.",
  };
}

/** Presets das VPS do operador. */
export function capacityForKnownVps(name, engine = "native") {
  const presets = {
    test4g2c: { ramMb: 4096, vcpu: 2, label: "VPS teste 4GB/2vCPU" },
    prod10g5c: { ramMb: 10240, vcpu: 5, label: "VPS alvo ~10GB/5vCPU" },
  };
  const p = presets[name];
  if (!p) throw new Error("Preset desconhecido: " + name);
  return { label: p.label, ...estimateHostedCapacity({ ...p, engine }) };
}
