/**
 * Fase 4 — smoke da fila hosted (cap=1 → 2ª partida QUEUED → promove).
 * Usa fixture (sem Chrome / sem FBNeo).
 *
 *   $env:HOSTED_ENGINE="native"
 *   npm run smoke:hosted-queue
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
fs.mkdirSync(path.join(root, "work"), { recursive: true });
const dir = fs.mkdtempSync(path.join(root, "work", "queue-smoke-"));
const port = 18000 + Math.floor(Math.random() * 1000);
const dbPath = path.join(dir, "arena.db");
const base = `http://127.0.0.1:${port}`;

const env = {
  ...process.env,
  NODE_ENV: "development",
  PORT: String(port),
  HOST: "127.0.0.1",
  DB_PATH: dbPath,
  HOSTED_ENGINE: "native",
  HOSTED_MAX_SESSIONS: "1",
  ENABLE_SIMULATED_FUNDS: "1",
  DOTENV_CONFIG_PATH: path.join(dir, "absent.env"),
  ADMIN_PASSWORD: "TestAdmin_Queue_123!",
  MATCH_LOADING_MS: "180000",
  READY_CHECK_COUNTDOWN_SEC: "0",
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let child;
let log = "";
const sockets = [];

async function request(p) {
  const r = await fetch(base + p, { signal: AbortSignal.timeout(5000) });
  const raw = await r.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    body = raw;
  }
  return { status: r.status, body };
}

async function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: base });
  sockets.push(ws);
  const messages = [];
  ws.on("message", (r) => messages.push(JSON.parse(String(r))));
  await new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });
  const c = {
    ws,
    send: (d) => ws.send(JSON.stringify(d)),
    async wait(type, pred = () => true, ms = 10000) {
      const start = Date.now();
      while (Date.now() - start < ms) {
        const i = messages.findIndex((m) => m.type === type && pred(m));
        if (i >= 0) return messages.splice(i, 1)[0];
        await delay(20);
      }
      throw new Error(
        "Timeout " + type + " | last=" + JSON.stringify(messages.slice(-5)),
      );
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
    email: name + "@queue.test",
    password: "TestOnly_123456",
  });
  c.auth = await c.wait("AUTH_SUCCESS");
  return c;
}

try {
  console.log(JSON.stringify({ phase: "start", hostPhase: 4, port }));
  child = spawn(process.execPath, ["tests/fixtures/hosted-platform.js"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));

  for (let i = 0; i < 120; i++) {
    if (child.exitCode != null) throw new Error(log || "server exit");
    try {
      if ((await request("/health")).status === 200) break;
    } catch {
      /* wait */
    }
    await delay(50);
    if (i === 119) throw new Error("health timeout\n" + log.slice(-1500));
  }

  const stamp = Date.now().toString(36);
  const a = await register("Qa" + stamp);
  const b = await register("Qb" + stamp);
  const c = await register("Qc" + stamp);
  const d = await register("Qd" + stamp);

  const rooms = (await request("/api/rooms")).body;
  const room = Array.isArray(rooms) ? rooms[0]?.id : rooms?.rooms?.[0]?.id;
  if (!room) throw new Error("Sem sala: " + JSON.stringify(rooms));

  for (const p of [a, b, c, d]) {
    p.send({ type: "JOIN_ROOM", roomId: room });
    await p.wait("ROOM_JOINED");
  }

  a.send({
    type: "SEND_CHALLENGE",
    targetUserId: b.auth.user.id,
    mode: "APOSTADO",
    stakeCents: 500,
  });
  const ch1 = await b.wait("CHALLENGE_RECEIVED");
  b.send({ type: "ACCEPT_CHALLENGE", challengeId: ch1.challengeId });
  const m1 = await a.wait("MATCH_STARTED");
  await b.wait("MATCH_STARTED");

  c.send({
    type: "SEND_CHALLENGE",
    targetUserId: d.auth.user.id,
    mode: "APOSTADO",
    stakeCents: 500,
  });
  const ch2 = await d.wait("CHALLENGE_RECEIVED");
  d.send({ type: "ACCEPT_CHALLENGE", challengeId: ch2.challengeId });
  const m2 = await c.wait("MATCH_STARTED");
  const queued = await c.wait("HOSTED_QUEUED");

  console.log(
    JSON.stringify({
      phase: "queued",
      match1: m1.matchId,
      match2: m2.matchId,
      placeInQueue: queued.placeInQueue || queued.position,
    }),
  );

  a.send({ type: "CANCEL_MATCH", matchId: m1.matchId });
  await a.wait("MATCH_CANCELLED");
  const deq = await c.wait("HOSTED_DEQUEUED");

  const cap = await request("/api/ops/hosted-cap");
  console.log(
    JSON.stringify(
      {
        phase: "ok",
        hostPhase: 4,
        dequeuedMatchId: deq.matchId || m2.matchId,
        hostedMaxSessionsEnv: 1,
        hostedMaxSessionsApi: cap.body?.hostedMaxSessions,
        note: "QUEUED→DEQUEUED OK. Em produção use HOSTED_MAX_SESSIONS=6.",
      },
      null,
      2,
    ),
  );
  process.exitCode = 0;
} catch (error) {
  console.error(
    JSON.stringify({
      phase: "failed",
      error: error.message,
      logTail: log.slice(-2500),
    }),
  );
  process.exitCode = 1;
} finally {
  for (const s of sockets) {
    try {
      s.terminate();
    } catch {
      /* ignore */
    }
  }
  if (child && child.exitCode == null) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}
