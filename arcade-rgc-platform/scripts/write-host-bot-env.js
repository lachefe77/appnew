/**
 * Grava .env correto para Fase 4c (Windows Host Bot).
 * Uso: npm run env:host-bot
 *
 * Não commits .env — só cria/atualiza o ficheiro local.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

const candidates = [
  process.env.HOST_BOT_BIN,
  "D:\\retroarch\\retroarch.exe",
  "C:\\RetroArch\\retroarch.exe",
  path.join(process.env["ProgramFiles"] || "C:\\Program Files", "RetroArch", "retroarch.exe"),
  path.join(
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    "RetroArch",
    "retroarch.exe",
  ),
].filter(Boolean);

let bin = candidates.find((p) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
});

if (!bin && process.platform === "win32") {
  // Procura rápida em D:\retroarch e Downloads
  const roots = ["D:\\retroarch", path.join(process.env.USERPROFILE || "", "Downloads")];
  for (const r of roots) {
    if (!r || !fs.existsSync(r)) continue;
    const hit = walkFind(r, "retroarch.exe", 4);
    if (hit) {
      bin = hit;
      break;
    }
  }
}

function walkFind(dir, name, depth) {
  if (depth < 0) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name) return full;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(dir, e.name);
    const hit = walkFind(full, name, depth - 1);
    if (hit) return hit;
  }
  return null;
}

if (!bin) {
  console.error(
    JSON.stringify({
      phase: "failed",
      error:
        "retroarch.exe não encontrado. Instala em D:\\retroarch ou passa HOST_BOT_BIN=...",
    }),
  );
  process.exit(1);
}

const lines = [
  "# Gerado por npm run env:host-bot — NÃO commits este ficheiro",
  "HOSTED_ENGINE=native",
  "HOSTED_MAX_SESSIONS=6",
  "ENABLE_SIMULATED_FUNDS=1",
  "DEMO_CREDIT_CENTS=200000",
  `HOST_BOT_BIN=${bin}`,
  "HOST_BOT_KIND=retroarch",
  "HOST_BOT_WORKDIR=data/hosted/kof2002",
  "HOST_BOT_FFMPEG=ffmpeg",
  "HOST_BOT_FFMPEG_INPUT_KIND=gdigrab",
  "HOST_BOT_FFMPEG_GRAB=desktop-crop",
  "HOST_BOT_VERBOSE=1",
  "HOST_BOT_INPUT=auto",
  "# Captura = crop DWM da janela (nunca title=/hwnd= — crashava o RetroArch)",
  "# Input: keybd_event + foco breve no RetroArch (ARENA_INPUT_FOCUS=0 desliga foco)",
  "",
];

fs.writeFileSync(envPath, lines.join("\n"), { encoding: "utf8" });

console.log(
  JSON.stringify(
    {
      phase: "ok",
      wrote: envPath,
      HOST_BOT_BIN: bin,
      binExists: fs.existsSync(bin),
      note: "Reinicia npm run test:local depois disto.",
    },
    null,
    2,
  ),
);
