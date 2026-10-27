import { readFileSync } from "fs";
import { resolve } from "path";

try {
  const text = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
} catch {
  /* o ambiente já pode ter as variáveis */
}
