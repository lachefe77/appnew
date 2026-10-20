/**
 * Aplica o tema global da Arena (servidor) + fallback local.
 * Admin define via POST /api/admin/theme; clientes ouvem THEME_UPDATED no WS.
 */
const KEY = "arena.theme";

const COLOR_KEYS = [
  "bg",
  "panel",
  "elev",
  "text",
  "muted",
  "accent",
  "accent2",
  "line",
  "ok",
  "danger",
];

export function applyTheme(theme) {
  if (!theme?.colors) return;
  const root = document.documentElement;
  const c = theme.colors;
  const map = {
    "--bg-dark": c.bg,
    "--bg": c.bg,
    "--bg-card": c.panel,
    "--bg-panel": c.panel,
    "--panel": c.panel,
    "--bg-card-sub": c.elev,
    "--bg-hover": c.elev,
    "--elev": c.elev,
    "--text": c.text,
    "--text-main": c.text,
    "--text-muted": c.muted,
    "--muted": c.muted,
    "--accent": c.accent,
    "--neon-red": c.accent,
    "--kof-crimson": c.accent,
    "--kof-fire": c.accent,
    "--neon-cyan": c.accent2,
    "--accent2": c.accent2,
    "--neon-gold": c.accent2,
    "--gold": c.accent2,
    "--border-color": c.line,
    "--line": c.line,
    "--ok": c.ok,
    "--neon-green": c.ok,
    "--danger": c.danger,
  };
  for (const [k, v] of Object.entries(map)) if (v) root.style.setProperty(k, v);
  root.dataset.theme = theme.id || "";
  if (theme.fonts?.display)
    root.style.setProperty(
      "--font-display",
      `"${theme.fonts.display}", sans-serif`,
    );
  if (theme.fonts?.ui)
    root.style.setProperty("--font-ui", `"${theme.fonts.ui}", sans-serif`);
  if (theme.fonts?.mono)
    root.style.setProperty(
      "--font-mono",
      `"${theme.fonts.mono}", ui-monospace, monospace`,
    );
  document.body && (document.body.style.background = c.bg || "");
  document.dispatchEvent(
    new CustomEvent("arena:theme", { detail: { id: theme.id, theme } }),
  );
}

export async function fetchServerTheme() {
  const res = await fetch("/api/theme", { cache: "no-store" });
  if (!res.ok) throw new Error("Tema do servidor indisponível");
  return res.json();
}

export async function loadThemes() {
  const res = await fetch("/themes/themes.json", { cache: "no-store" });
  if (!res.ok) throw new Error("themes.json indisponível");
  return res.json();
}

export async function bootTheme(preferredId) {
  try {
    const serverTheme = await fetchServerTheme();
    applyTheme(serverTheme);
    localStorage.setItem(KEY, serverTheme.id);
    return { theme: serverTheme, source: "server" };
  } catch {
    const catalog = await loadThemes();
    const id =
      preferredId ||
      localStorage.getItem(KEY) ||
      catalog.defaultTheme ||
      "neogeo-cabinet";
    const theme =
      catalog.themes.find((t) => t.id === id) ||
      catalog.themes.find((t) => t.id === "neogeo-cabinet") ||
      catalog.themes[0];
    applyTheme(theme);
    return { catalog, theme, source: "local" };
  }
}

export function setTheme(id, catalog) {
  const theme = catalog.themes.find((t) => t.id === id);
  if (!theme) return null;
  localStorage.setItem(KEY, id);
  applyTheme(theme);
  return theme;
}

export async function saveServerTheme(id, colors, token) {
  const res = await fetch("/api/admin/theme", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ id, colors }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.message || "Falha ao salvar tema");
  applyTheme(body.theme);
  localStorage.setItem(KEY, body.theme.id);
  return body.theme;
}

export { COLOR_KEYS };

if (!window.__arenaThemeBooted) {
  window.__arenaThemeBooted = true;
  bootTheme("neogeo-cabinet").catch(() => {});
  window.ArenaTheme = {
    bootTheme,
    setTheme,
    loadThemes,
    applyTheme,
    fetchServerTheme,
    saveServerTheme,
    COLOR_KEYS,
  };
}
