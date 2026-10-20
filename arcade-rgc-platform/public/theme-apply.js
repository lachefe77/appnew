/**
 * Aplica tema Arena Arcade a partir de /themes/themes.json e localStorage.
 * Uso: <script type="module" src="/theme-apply.js"></script>
 */
const KEY = "arena.theme";

function applyTheme(theme) {
  if (!theme?.colors) return;
  const root = document.documentElement;
  const c = theme.colors;
  const map = {
    "--bg-dark": c.bg,
    "--bg": c.bg,
    "--bg-panel": c.panel,
    "--panel": c.panel,
    "--elev": c.elev,
    "--text": c.text,
    "--text-muted": c.muted,
    "--muted": c.muted,
    "--accent": c.accent,
    "--neon-red": c.accent,
    "--neon-cyan": c.accent2,
    "--accent2": c.accent2,
    "--border-color": c.line,
    "--line": c.line,
    "--ok": c.ok,
    "--neon-green": c.ok,
    "--danger": c.danger,
    "--gold": c.accent2,
  };
  for (const [k, v] of Object.entries(map)) if (v) root.style.setProperty(k, v);
  root.dataset.theme = theme.id;
  if (theme.fonts?.display) {
    root.style.setProperty("--font-display", theme.fonts.display + ", sans-serif");
  }
  if (theme.fonts?.ui) {
    root.style.setProperty("--font-ui", theme.fonts.ui + ", sans-serif");
  }
  document.dispatchEvent(
    new CustomEvent("arena:theme", { detail: { id: theme.id, theme } }),
  );
}

export async function loadThemes() {
  const res = await fetch("/themes/themes.json", { cache: "no-store" });
  if (!res.ok) throw new Error("themes.json indisponível");
  return res.json();
}

export async function bootTheme(preferredId) {
  const catalog = await loadThemes();
  const id =
    preferredId ||
    localStorage.getItem(KEY) ||
    catalog.defaultTheme ||
    catalog.themes[0]?.id;
  const theme = catalog.themes.find((t) => t.id === id) || catalog.themes[0];
  applyTheme(theme);
  return { catalog, theme };
}

export function setTheme(id, catalog) {
  const theme = catalog.themes.find((t) => t.id === id);
  if (!theme) return null;
  localStorage.setItem(KEY, id);
  applyTheme(theme);
  return theme;
}

if (!window.__arenaThemeBooted) {
  window.__arenaThemeBooted = true;
  bootTheme().catch(() => {});
  window.ArenaTheme = { bootTheme, setTheme, loadThemes, applyTheme };
}
