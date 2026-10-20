/**
 * Child process: Bo3 só liquida após 2 vitórias; SERIES_GAME_RESULT intermediário
 * não libera reservas; FIXTURE_RESULT / SERIES_GAME_RESULT via IPC.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { startPlatform } from "../server/platform.js";

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
    async wait(type, predicate = () => true, ms = 5000) {
      const start = Date.now();
      while (Date.now() - start < ms) {
        const i = messages.findIndex((m) => m.type === type && predicate(m));
        if (i >= 0) return messages.splice(i, 1)[0];
        await delay(10);
      }
      throw Error("Timeout " + type + " " + JSON.stringify(messages.slice(-8)));
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
    email: name + "@series.test",
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

const a = await register("Series_A");
const b = await register("Series_B");
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
  seriesBestOf: 3,
});
const ch = await b.wait("CHALLENGE_RECEIVED");
assert.equal(ch.seriesBestOf, 3);
b.send({ type: "ACCEPT_CHALLENGE", challengeId: ch.challengeId });
const m = await a.wait("MATCH_STARTED");
await b.wait("MATCH_STARTED");
assert.equal(m.seriesBestOf, 3);
assert.deepEqual(m.seriesScore, { a: 0, b: 0 });

for (const p of [a, b]) p.send({ type: "GAME_READY", matchId: m.matchId });
await a.wait("GAME_RUNNING");
await b.wait("GAME_RUNNING");

const session = sessions.get(m.matchId);
assert.ok(session);

// Game 1 via SERIES_GAME_RESULT — série continua.
session.onObservation({
  event: "SERIES_GAME_RESULT",
  sample: { winnerSlot: 1, source: "series-fixture" },
});
const g1 = await a.wait("SERIES_GAME_ENDED");
assert.deepEqual(g1.seriesScore, { a: 1, b: 0 });
await a.wait("SERIES_NEXT_GAME");
assert.ok(sessions.has(m.matchId), "sessão/reservas preservadas entre games");

// Game 2 — fecha Bo3 (2 vitórias).
session.onResult({
  winnerSlot: 1,
  source: "series-fixture-final",
  frame: 99,
});
const ended = await a.wait("MATCH_ENDED");
assert.equal(ended.winnerId, a.auth.user.id);
assert.deepEqual(ended.seriesScore, { a: 2, b: 0 });
assert.equal(ended.seriesBestOf, 3);

// Convite de sala
a.send({ type: "CREATE_ROOM_INVITE" });
const invite = await a.wait("ROOM_INVITE_CREATED");
assert.match(invite.code, /^KOF-/);
const redeemed = await request(
  "/api/invites/redeem",
  { code: invite.code },
  a.auth.sessionToken,
);
assert.equal(redeemed.status, 200);
assert.equal(redeemed.body.roomId, room);

console.log("ok");
await app.close();
process.exit(0);
