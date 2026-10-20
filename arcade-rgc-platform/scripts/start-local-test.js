// Local development only: explicit demo credits, isolated database copy.
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import Database from "better-sqlite3";
process.env.NODE_ENV = "development";
process.env.ENABLE_SIMULATED_FUNDS = "1";
process.env.HOST = "127.0.0.1";
process.env.PORT = process.env.ARENA_TEST_PORT || "3001";
process.env.DB_PATH = fileURLToPath(
  new URL("../data/arena-test.db", import.meta.url),
);
const original = fileURLToPath(new URL("../data/arena.db", import.meta.url));
if (!fs.existsSync(process.env.DB_PATH) && fs.existsSync(original)) {
  const source = new Database(original, { readonly: true });
  try {
    await source.backup(process.env.DB_PATH);
  } finally {
    source.close();
  }
  console.log(
    "[TESTE] Criada cópia consistente do banco em data/arena-test.db.",
  );
}
await import("../server/index.js");
