import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// Read-only validation; never import db.js or run migrations while inspecting a copy.
export function inspectSnapshot(file) {
  const db = new Database(path.resolve(file), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    return db.transaction(() => {
      const integrity = db.pragma("integrity_check", { simple: true });
      if (integrity !== "ok") throw Error("Integridade SQLite inválida.");
      const mismatches = [];
      for (const w of db.prepare("SELECT * FROM wallets").all()) {
        const total = (account) =>
          db
            .prepare(
              "SELECT COALESCE(SUM(delta),0) n FROM finance_entries WHERE account=?",
            )
            .get(account).n;
        const reserved = db
          .prepare(
            "SELECT COALESCE(SUM(amount),0) n FROM reservations WHERE user_id=? AND status='LOCKED'",
          )
          .get(w.user_id).n;
        if (
          total(`user:${w.user_id}:available`) !== w.balance ||
          total(`user:${w.user_id}:locked`) !== w.locked ||
          reserved !== w.locked
        )
          mismatches.push(w.user_id);
      }
      const unbalanced = db
        .prepare(
          "SELECT event_id FROM finance_entries GROUP BY event_id HAVING SUM(delta) != 0",
        )
        .all().length;
      if (mismatches.length || unbalanced)
        throw Error("Conciliação financeira inválida na cópia.");
      return {
        integrity,
        reconciliation: true,
        wallets: db.prepare("SELECT COUNT(*) n FROM wallets").get().n,
      };
    })();
  } finally {
    db.close();
  }
}
export async function copySnapshot(source, destination) {
  source = path.resolve(source);
  destination = path.resolve(destination);
  if (source === destination)
    throw Error("Origem e destino devem ser diferentes.");
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    // Exclusive creation protects both existing backups and any active database.
    const fd = fs.openSync(destination, "wx", 0o600);
    fs.closeSync(fd);
    await db.backup(destination);
    return { file: destination, ...inspectSnapshot(destination) };
  } finally {
    db.close();
  }
}
