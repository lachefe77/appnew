import fs from "node:fs";
import path from "node:path";
import {
  projectRoot,
  hostedDir,
  assetHash,
  verifyHostedAssets,
} from "../server/hosted-assets.js";
import { inspectZip, validateBios, validateRom } from "../public/rom-check.js";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
try {
  const rom = argument("--rom"),
    bios = argument("--bios");
  if (!rom || !bios)
    throw Error(
      'Use: npm run setup:hosted -- --rom "caminho/kof2002.zip" --bios "caminho/neogeo.zip"',
    );
  const runtime = JSON.parse(
    fs.readFileSync(
      path.join(projectRoot, "public/emulatorjs/data/manifest.json"),
      "utf8",
    ),
  );
  const manifest = {
    version: 1,
    game: "kof2002-original",
    core: "fbneo-legacy-wasm",
    emulatorjs: "4.2.3",
    files: {},
    runtime: Object.fromEntries(
      Object.entries(runtime.files).map(([name, value]) => [
        name,
        value.sha256,
      ]),
    ),
    preparedAt: new Date().toISOString(),
    purpose: "private-demo-no-real-money",
  };
  const sources = [
    [rom, "kof2002.zip", validateRom],
    [bios, "neogeo.zip", validateBios],
  ];
  const validated = sources.map(([source, name, validate]) => {
    const bytes = fs.readFileSync(source);
    validate(
      inspectZip(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      ),
    );
    return { name, bytes };
  });
  fs.mkdirSync(hostedDir, { recursive: true });
  for (const { name, bytes } of validated) {
    fs.writeFileSync(path.join(hostedDir, name), bytes);
    manifest.files[name] = { bytes: bytes.length, sha256: assetHash(bytes) };
  }
  fs.writeFileSync(
    path.join(hostedDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  verifyHostedAssets();
  console.log(
    "Jogo privado preparado. ROM/BIOS não serão servidas aos jogadores. Teste local com créditos fictícios.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
