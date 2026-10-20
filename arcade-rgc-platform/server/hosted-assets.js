import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { inspectZip, validateBios, validateRom } from "../public/rom-check.js";

export const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const hostedDir = path.resolve(
  process.env.HOSTED_GAME_DIR || path.join(projectRoot, "data/hosted/kof2002"),
);
export const assetHash = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
export function verifyHostedAssets(directory = hostedDir) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, "manifest.json"), "utf8"),
  );
  if (manifest.version !== 1 || manifest.game !== "kof2002-original")
    throw Error("Manifesto de jogo hospedado inválido.");
  const files = {};
  for (const [name, validator] of [
    ["kof2002.zip", validateRom],
    ["neogeo.zip", validateBios],
  ]) {
    const location = path.join(directory, name),
      bytes = fs.readFileSync(location);
    if (assetHash(bytes) !== manifest.files[name]?.sha256)
      throw Error("Integridade do arquivo privado alterada: " + name);
    validator(
      inspectZip(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      ),
    );
    files[name] = location;
  }
  // Pin every installed runtime asset, not only the loader; public players cannot
  // select another build for a hosted credit challenge.
  const installed = JSON.parse(
    fs.readFileSync(
      path.join(projectRoot, "public/emulatorjs/data/manifest.json"),
      "utf8",
    ),
  );
  if (installed.version !== "4.2.3")
    throw Error("Versão do runtime não aprovada para este perfil.");
  for (const [name, entry] of Object.entries(installed.files)) {
    const bytes = fs.readFileSync(
      path.join(projectRoot, "public/emulatorjs/data", name),
    );
    if (
      assetHash(bytes) !== entry.sha256 ||
      manifest.runtime[name] !== entry.sha256
    )
      throw Error("Runtime alterado: " + name);
  }
  return { files, manifest, runtimeFiles: Object.keys(installed.files) };
}
