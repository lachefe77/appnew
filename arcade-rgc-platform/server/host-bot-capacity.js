/**
 * Estimativa + calibração de densidade de X1 hosted.
 * Fase 3: mesclar estimativa estática com relatório medido (bench).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

export const CAPACITY_REPORT_DIR = path.join(root, "data", "capacity");

/**
 * @param {{ ramMb: number, vcpu: number, engine?: 'chrome'|'native', osReserveMb?: number, headroom?: number }} opts
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

/**
 * A partir de amostras RSS do bench, estima MB/sessão e recomenda HOSTED_MAX_SESSIONS.
 * @param {{
 *   samples: Array<{ at: number, rssMb: number, sessions: number }>,
 *   sessions: number,
 *   ramMb?: number,
 *   vcpu?: number,
 *   osReserveMb?: number,
 *   headroom?: number,
 *   baselineRssMb?: number,
 *   mode?: string,
 *   durationSec?: number,
 *   failures?: number,
 * }} measured
 */
export function calibrateFromMeasurement(measured) {
  const sessions = Math.max(1, Number(measured.sessions) || 1);
  const samples = Array.isArray(measured.samples) ? measured.samples : [];
  const ramMb = Number(measured.ramMb) || 4096;
  const vcpu = Number(measured.vcpu) || 2;
  const osReserveMb = Number(measured.osReserveMb) || 1536;
  const headroomRaw = Number(measured.headroom);
  const headroom = Number.isFinite(headroomRaw) ? headroomRaw : 0.25;
  const baseline = Number(measured.baselineRssMb) || 0;
  const failures = Number(measured.failures) || 0;

  const peakRss = samples.length
    ? Math.max(...samples.map((s) => Number(s.rssMb) || 0))
    : baseline;
  const lastRss = samples.length
    ? Number(samples[samples.length - 1].rssMb) || peakRss
    : peakRss;
  const avgRss = samples.length
    ? samples.reduce((a, s) => a + (Number(s.rssMb) || 0), 0) / samples.length
    : peakRss;

  // Custo marginal por sessão (RSS processo Node pai + workers filhos no mesmo RSS do OS
  // não entra aqui — usamos delta vs baseline quando disponível).
  const delta = Math.max(0, avgRss - baseline);
  const mbPerSession =
    sessions > 0 ? Math.max(30, Math.round(delta / sessions) || Math.round(avgRss / sessions)) : 0;

  const usable = Math.max(0, ramMb - osReserveMb);
  const byRam = mbPerSession > 0
    ? Math.floor((usable * (1 - headroom)) / mbPerSession)
    : 0;
  const estimate = estimateHostedCapacity({ ramMb, vcpu, engine: "native", osReserveMb, headroom });
  // Mistura medida (RAM) com teto de CPU da estimativa estática.
  const recommended = Math.max(
    0,
    Math.min(byRam || estimate.recommended, estimate.maxByCpu, sessions > 0 ? sessions : estimate.recommended),
  );
  // Se o bench aguentou N sem falhas e N <= byRam, recomendar pelo menos N (com teto CPU).
  const heldOk = failures === 0 && sessions > 0;
  const calibrated = heldOk
    ? Math.min(
        Math.max(recommended, Math.min(sessions, byRam || sessions)),
        estimate.maxByCpu,
      )
    : recommended;

  const stable =
    failures === 0 &&
    samples.length >= 2 &&
    peakRss > 0 &&
    lastRss <= peakRss * 1.15;

  return {
    engine: "native",
    mode: measured.mode || "peers",
    sessionsBench: sessions,
    durationSec: Number(measured.durationSec) || 0,
    failures,
    stable,
    rss: {
      baselineMb: baseline,
      avgMb: Math.round(avgRss),
      peakMb: Math.round(peakRss),
      lastMb: Math.round(lastRss),
      mbPerSession,
    },
    machine: { ramMb, vcpu, osReserveMb, headroom },
    maxByMeasuredRam: Math.max(0, byRam),
    maxByCpuEstimate: estimate.maxByCpu,
    recommendedHostedMaxSessions: calibrated,
    suggestedEnv: `HOSTED_MAX_SESSIONS=${calibrated}`,
    notes: stable
      ? "Bench estável; usar recommendedHostedMaxSessions como ponto de partida e revalidar com duração ≥ 600s na VPS."
      : "Bench instável ou curto; não subir HOSTED_MAX_SESSIONS sem novo teste.",
  };
}

export function capacityReportPath(name = "latest.json") {
  return path.join(CAPACITY_REPORT_DIR, name);
}

export function writeCapacityReport(report, fileName = "latest.json") {
  fs.mkdirSync(CAPACITY_REPORT_DIR, { recursive: true });
  const file = capacityReportPath(fileName);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  // também timestamp
  const stamp = `bench-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(capacityReportPath(stamp), JSON.stringify(report, null, 2));
  return { latest: file, stamped: capacityReportPath(stamp) };
}

export function readLatestCapacityReport() {
  const file = capacityReportPath("latest.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Payload enriquecido para /api/ops/hosted-cap. */
export function hostedCapOpsPayload({
  engine,
  hostedMaxSessions,
  hostedActiveSessions,
}) {
  const estimate = {
    testVps4g2c: capacityForKnownVps("test4g2c", engine),
    prodVps10g5c: capacityForKnownVps("prod10g5c", engine),
  };
  const latest = readLatestCapacityReport();
  return {
    hostedEngine: engine,
    hostedMaxSessions,
    hostedActiveSessions,
    isolation:
      engine === "native"
        ? "host-bot-process-per-session"
        : "playwright-browser-per-session",
    capacityEstimate: estimate,
    capacityMeasured: latest
      ? {
          at: latest.at,
          calibration: latest.calibration,
          sessions: latest.sessions,
          durationSec: latest.durationSec,
          mode: latest.mode,
          path: "data/capacity/latest.json",
        }
      : null,
    note:
      engine === "native"
        ? latest
          ? "Estimativa + último bench em data/capacity/latest.json. Revalidar ≥600s na VPS 4GB."
          : "Host Bot nativo. Correr npm run bench:host-bot na VPS para calibrar HOSTED_MAX_SESSIONS."
        : "Engine chrome/Playwright — densidade baixa; use HOSTED_ENGINE=native.",
  };
}
