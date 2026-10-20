import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { copySnapshot, inspectSnapshot } from "../server/database-snapshot.js";
test("consistent snapshot preserves wallets, reserved funds and pending review without migrations", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-snapshot-"));
  const source = path.join(dir, "source.db"),
    backup = path.join(dir, "backup.db"),
    restored = path.join(dir, "restored.db");
  const db = new Database(source);
  try {
    db.pragma("journal_mode=WAL");
    db.exec(
      `CREATE TABLE wallets(user_id TEXT,balance INTEGER,locked INTEGER); CREATE TABLE finance_entries(event_id TEXT,account TEXT,delta INTEGER); CREATE TABLE reservations(user_id TEXT,amount INTEGER,status TEXT); CREATE TABLE match_reviews(id TEXT,status TEXT); INSERT INTO wallets VALUES('u1',1500,500); INSERT INTO finance_entries VALUES('opening','user:u1:available',1500),('opening','user:u1:locked',500),('opening','external:opening',-2000); INSERT INTO reservations VALUES('u1',500,'LOCKED'); INSERT INTO match_reviews VALUES('pending','OPEN');`,
    );
    assert.equal((await copySnapshot(source, backup)).reconciliation, true);
    assert.equal(inspectSnapshot(backup).wallets, 1);
    await copySnapshot(backup, restored);
    const copy = new Database(restored, { readonly: true });
    try {
      assert.deepEqual(
        copy.prepare("SELECT * FROM wallets").all(),
        db.prepare("SELECT * FROM wallets").all(),
      );
      assert.deepEqual(copy.prepare("SELECT * FROM match_reviews").all(), [
        { id: "pending", status: "OPEN" },
      ]);
    } finally {
      copy.close();
    }
    await assert.rejects(copySnapshot(source, backup), /EEXIST/);
    await assert.rejects(copySnapshot(source, source), /diferentes/);
    db.prepare("UPDATE wallets SET balance=0").run();
    assert.throws(() => inspectSnapshot(source), /Conciliação/);
    assert.equal(inspectSnapshot(backup).reconciliation, true);
  } finally {
    db.close();
    const resolved = path.resolve(dir);
    assert.ok(
      resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(resolved).startsWith("arena-snapshot-"),
    );
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
