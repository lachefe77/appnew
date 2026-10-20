/**
 * E2E “partida 100%”: challenge → hosted fixture → observer win → settle → conciliação.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { startPlatform } from "../server/platform.js";
import { finance } from "../server/finance.js";

const sessions = new Map();
const reserve = net.createServer();
await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));

const app = startPlatform({
  port,
  host: "127.0.0.1",
  hostedFactory: (options) => {
    const session = {
      async start() {
        sessions.set(options.matchId, options);
        options.onProgress?.("assets");
        options.onProgress?.("boot");
        options.onPeer(1, "connected");
        options.onPeer(2, "connected");
        return { manifest: { fixture: true } };
      },
      async stop() {
        sessions.delete(options.matchId);
      },
      async input() {},
      async signal() {},
      async pause() {},
      async resume() {},
    };
    return session;
  },
});

const base = `http://127.0.0.1:${port}`;
async function request(endpoint, data, token) {
  const r = await fetch(base + endpoint, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { status: r.status, body: await r.json() };
}

async function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: base });
  const messages = [];
  ws.on("message", (r) => messages.push(JSON.parse(r)));
  await new Promise((r, j) => {
    ws.once("open", r);
    ws.once("error", j);
  });
  const c = {
    ws,
    send: (d) => ws.send(JSON.stringify(d)),
    async wait(type, predicate = () => true, ms = 8000) {
      const start = Date.now();
      while (Date.now() - start < ms) {
        const i = messages.findIndex((m) => m.type === type && predicate(m));
        if (i >= 0) return messages.splice(i, 1)[0];
        await delay(10);
      }
      throw Error("Timeout " + type + " " + JSON.stringify(messages.slice(-10)));
    },
  };
  await c.wait("INIT_SESSION");
  return c;
}

async function register(name) {
  const c = await connect();
  c.send({
    type: "REGISTER_ACCOUNT",
    username: name,
    email: name + "@partida100.test",
    password: "TestOnly_123456",
  });
  c.auth = await c.wait("AUTH_SUCCESS");
  return c;
}

for (let i = 0; i < 80; i++) {
  try {
    if ((await request("/health")).status === 200) break;
  } catch {}
  await delay(50);
}

const a = await register("P100_A");
const b = await register("P100_B");
const rooms = (await request("/api/rooms")).body;
const room = rooms[0].id;
for (const p of [a, b]) {
  p.send({ type: "JOIN_ROOM", roomId: room });
  await p.wait("ROOM_JOINED");
}

a.send({
  type: "SEND_CHALLENGE",
  targetUserId: b.auth.user.id,
  mode: "APOSTADO",
  stakeCents: 500,
  seriesBestOf: 1,
});
const ch = await b.wait("CHALLENGE_RECEIVED");
b.send({ type: "ACCEPT_CHALLENGE", challengeId: ch.challengeId });
const m = await a.wait("MATCH_STARTED");
await b.wait("MATCH_STARTED");
assert.equal(m.mode, "APOSTADO");

for (const p of [a, b]) p.send({ type: "GAME_READY", matchId: m.matchId });
await a.wait("GAME_RUNNING");
await b.wait("GAME_RUNNING");

const session = sessions.get(m.matchId);
assert.ok(session, "hosted fixture ativo");

session.onResult({
  winnerSlot: 1,
  source: "partida-100-fixture",
  frame: 500,
});
const ended = await a.wait("MATCH_ENDED");
assert.equal(ended.winnerId, a.auth.user.id);
assert.equal(ended.rematchEligible, true);
await a.wait("REMATCH_AVAILABLE");

const health = await request("/health");
assert.equal(health.body.status, "ok");
assert.equal(health.body.reconciliation, true);
assert.equal(finance.reconcile().ok, true);

const hist = await request("/api/me/matches", undefined, a.auth.sessionToken);
assert.ok(hist.body.matches?.length >= 1);

console.log("ok-partida-100");
await delay(50);
process.exit(0);
