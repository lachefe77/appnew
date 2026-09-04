#!/usr/bin/env bash
# Idempotent bootstrap for the Delay Xit Chrome/Edge MV3 extension.
#
# This repository ships the extension as a packaged archive ("app lifetime.zip")
# with no build step. Development means loading the extension unpacked in a
# Chromium-based browser, so this script just extracts the archive into a stable
# ./unpacked directory that can be passed to `--load-extension` (or loaded via
# chrome://extensions -> "Load unpacked").
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ZIP="app lifetime.zip"
OUT="unpacked"

if [[ ! -f "$ZIP" ]]; then
  echo "ERROR: '$ZIP' not found in repo root ($ROOT)." >&2
  exit 1
fi

# Rebuild from the archive every run so the unpacked tree always matches the
# committed zip (idempotent: safe to re-run).
rm -rf "$OUT"
mkdir -p "$OUT"
unzip -q "$ZIP" -d "$OUT"

# The archive wraps everything in a single top-level folder
# ("delay xit lifetime/"). Flatten it so manifest.json sits at $OUT/manifest.json.
inner="$(find "$OUT" -mindepth 1 -maxdepth 1 -type d | head -n1)"
if [[ -n "${inner:-}" && -f "$inner/manifest.json" ]]; then
  shopt -s dotglob
  mv "$inner"/* "$OUT"/
  rmdir "$inner"
  shopt -u dotglob
fi

if [[ ! -f "$OUT/manifest.json" ]]; then
  echo "ERROR: manifest.json not found under '$OUT' after extraction." >&2
  exit 1
fi

echo "Extension unpacked to: $ROOT/$OUT"
node -e "const m=require('./$OUT/manifest.json'); console.log('Manifest OK:', m.name, 'v'+m.version, '(manifest_version '+m.manifest_version+')');"
