/**
 * Lab local: garante R$ 2.000,00 fake em todas as carteiras.
 *   npm run credit:demo
 * Usa DB_PATH do ambiente (test:local → data/arena-test.db) ou data/arena.db.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.DB_PATH) {
  process.env.DB_PATH = path.join(root, "data", "arena.db");
}
process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.ENABLE_SIMULATED_FUNDS = "1";

const TARGET_CENTS = Number(process.env.DEMO_CREDIT_CENTS) || 200_000; // R$ 2000

// finance primeiro (evita ciclo com db já carregado a meio)
const { finance } = await import("../server/finance.js");
const { default: db, Wallets } = await import("../server/db.js");

const users = db
  .prepare("SELECT id, username, email FROM users ORDER BY created_at")
  .all();

const out = [];
for (const u of users) {
  Wallets.ensure(u.id);
  const w = Wallets.get(u.id);
  const available = Number(w?.balance) || 0;
  const need = TARGET_CENTS - available;
  if (need > 0) {
    finance.credit(
      u.id,
      need,
      "TEST_CREDIT",
      "demo-topup:" + u.id,
      "Crédito fake lab — salda para R$ " + (TARGET_CENTS / 100).toFixed(2),
    );
  }
  const after = Wallets.get(u.id);
  out.push({
    username: u.username,
    email: u.email,
    beforeReais: (available / 100).toFixed(2),
    afterReais: ((after?.balance || 0) / 100).toFixed(2),
  });
}

console.log(
  JSON.stringify(
    {
      phase: "ok",
      db: process.env.DB_PATH,
      targetReais: (TARGET_CENTS / 100).toFixed(2),
      users: out.length,
      wallets: out,
    },
    null,
    2,
  ),
);
