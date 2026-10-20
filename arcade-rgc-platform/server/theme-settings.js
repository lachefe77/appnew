/**
 * Tema visual global da plataforma — persistido no SQLite.
 * Admin/MASTER escolhe preset ou sobrescreve cores.
 * Padrão da empresa: Vinyl Redline.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "./db.js";

const catalogPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/themes/themes.json",
);

const DEFAULT_THEME_ID = "vinyl-redline";

db.exec(`
  CREATE TABLE IF NOT EXISTS platform_settings(
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

function readCatalog() {
  const raw = fs.readFileSync(catalogPath, "utf8");
  return JSON.parse(raw);
}

function getPreset(id) {
  const catalog = readCatalog();
  const fallback = catalog.defaultTheme || DEFAULT_THEME_ID;
  const theme =
    catalog.themes.find((t) => t.id === id) ||
    catalog.themes.find((t) => t.id === fallback) ||
    catalog.themes[0];
  return { catalog, theme };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function sanitizeColors(input = {}) {
  const out = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (typeof v === "string" && HEX.test(v.trim())) out[k] = v.trim();
  }
  return out;
}

export function getActiveTheme() {
  const row = db
    .prepare("SELECT value FROM platform_settings WHERE key='active_theme'")
    .get();
  let stored = null;
  try {
    stored = row ? JSON.parse(row.value) : null;
  } catch {
    stored = null;
  }
  const { catalog, theme: preset } = getPreset(
    stored?.id || catalogDefaultId(),
  );
  const colors = {
    ...preset.colors,
    ...sanitizeColors(stored?.colors),
  };
  return {
    id: preset.id,
    name: preset.name,
    pitch: preset.pitch,
    family: preset.family || "",
    mood: preset.mood || "",
    fonts: preset.fonts,
    colors,
    customColors: sanitizeColors(stored?.colors),
    updatedAt: stored?.updatedAt || null,
    catalogVersion: catalog.version,
    defaultTheme: catalog.defaultTheme || DEFAULT_THEME_ID,
    presets: catalog.themes.map((t) => ({
      id: t.id,
      name: t.name,
      pitch: t.pitch,
      family: t.family || "",
      mood: t.mood || "",
      colors: t.colors,
      fonts: t.fonts,
    })),
  };
}

function catalogDefaultId() {
  try {
    return readCatalog().defaultTheme || DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

/**
 * Garante Vinyl Redline na primeira subida.
 * Se o banco ainda tiver o antigo neogeo-cabinet sem customização, migra para o novo padrão.
 */
export function ensureDefaultTheme() {
  const row = db
    .prepare("SELECT value FROM platform_settings WHERE key='active_theme'")
    .get();
  if (!row) return setActiveTheme({ id: DEFAULT_THEME_ID });
  let stored = null;
  try {
    stored = JSON.parse(row.value);
  } catch {
    return setActiveTheme({ id: DEFAULT_THEME_ID });
  }
  const custom = sanitizeColors(stored?.colors);
  const isLegacyDefault =
    stored?.id === "neogeo-cabinet" && Object.keys(custom).length === 0;
  if (isLegacyDefault) return setActiveTheme({ id: DEFAULT_THEME_ID });
  return getActiveTheme();
}

export function setActiveTheme({ id, colors } = {}) {
  const { theme: preset } = getPreset(id || DEFAULT_THEME_ID);
  const custom = sanitizeColors(colors);
  const payload = {
    id: preset.id,
    colors: custom,
    updatedAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO platform_settings(key,value,updated_at) VALUES('active_theme',?,datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
  ).run(JSON.stringify(payload));
  return getActiveTheme();
}

export default { getActiveTheme, setActiveTheme, ensureDefaultTheme };
