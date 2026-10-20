import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const version = "4.2.3";
const base = `https://cdn.emulatorjs.org/${version}/data/`;
const dest = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/emulatorjs/data",
);
const files = [
  "loader.js",
  "emulator.min.js",
  "emulator.min.css",
  "cores/fbneo-legacy-wasm.data",
  "cores/reports/fbneo.json",
  "compression/extract7z.js",
  "compression/extractzip.js",
];
const manifest = {
  version,
  source: base,
  files: {},
  downloadedAt: new Date().toISOString(),
};
try {
  for (const name of files) {
    const target = path.join(dest, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const response = await fetch(base + name, {
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) throw Error(`${name}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 20) throw Error("Arquivo incompleto: " + name);
    await fs.writeFile(target + ".part", bytes);
    await fs.rename(target + ".part", target);
    manifest.files[name] = {
      bytes: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
    console.log("OK", name, bytes.length);
  }
  await fs.writeFile(
    path.join(dest, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  console.log(
    "EmulatorJS " +
      version +
      " e core FBNeo instalados. ROM/BIOS não são incluídas.",
  );
} catch (e) {
  console.error("Instalação incompleta:", e.message);
  process.exitCode = 1;
}
