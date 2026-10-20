// Local development only: explicit demo credits, isolated database copy.
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
process.env.NODE_ENV = "development";
process.env.ENABLE_SIMULATED_FUNDS = "1";
process.env.DEMO_CREDIT_CENTS = process.env.DEMO_CREDIT_CENTS || "200000"; // R$ 2000
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
// Top-up R$2000 fake em todas as contas (teste123, 4241, etc.)
const creditScript = fileURLToPath(
  new URL("./credit-demo-wallets.js", import.meta.url),
);
const credited = spawnSync(process.execPath, [creditScript], {
  env: { ...process.env },
  encoding: "utf8",
});
if (credited.stdout) process.stdout.write(credited.stdout);
if (credited.status !== 0) {
  console.error(
    "[TESTE] Falha ao creditar carteiras:",
    credited.stderr || credited.error,
  );
} else {
  console.log("[TESTE] Carteiras com crédito fake R$ 2.000,00.");
}
await import("../server/index.js");
