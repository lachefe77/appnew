import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("catálogo tem 25 temas com ids estáveis", () => {
  const catalog = JSON.parse(
    fs.readFileSync(path.join(root, "public/themes/themes.json"), "utf8"),
  );
  assert.equal(catalog.themes.length, 25);
  assert.ok(catalog.themes.some((t) => t.id === "neogeo-cabinet"));
  assert.ok(catalog.themes.some((t) => t.id === "crt-phosphor"));
  for (const t of catalog.themes) {
    assert.ok(t.name && t.pitch && t.colors?.accent && t.fonts?.display, t.id);
  }
});

test("tema padrão Neo Geo e override de cores", async () => {
  const dir = fs.mkdtempSync(path.join(root, "work/theme-"));
  const child = spawn(
    process.execPath,
    [
      "-e",
      `
      process.env.DB_PATH = ${JSON.stringify(path.join(dir, "t.db"))};
      process.env.DOTENV_CONFIG_PATH = ${JSON.stringify(path.join(dir, "no.env"))};
      const m = await import(${JSON.stringify(path.join(root, "server/theme-settings.js"))});
      const a = m.ensureDefaultTheme();
      if (a.id !== "neogeo-cabinet") throw new Error("default " + a.id);
      if (a.colors.accent !== "#e10600") throw new Error("accent");
      const b = m.setActiveTheme({ id: "crt-phosphor", colors: { accent: "#112233" } });
      if (b.id !== "crt-phosphor") throw new Error("id");
      if (b.colors.accent !== "#112233") throw new Error("custom");
      const c = m.setActiveTheme({ id: "neogeo-cabinet", colors: {} });
      if (c.id !== "neogeo-cabinet") throw new Error("back");
      console.log("ok");
      `,
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let out = "",
    err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const code = await new Promise((r) => child.on("exit", r));
  assert.equal(code, 0, err || out);
  assert.match(out, /ok/);
});
