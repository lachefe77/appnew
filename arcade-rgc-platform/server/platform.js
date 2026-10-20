import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import db, {
  Users,
  Wallets,
  Transactions,
  Sessions,
  PendingWithdrawals,
  AuditLog,
  Stats,
  cleanupExpiredSessions,
  MatchmakingQueue,
} from "./db.js";
import { finance, cents, recoverMatches } from "./finance.js";
import { HostedSession } from "./hosted-session.js";
import { verifyHostedAssets } from "./hosted-assets.js";
import {
  makeRules,
  saveRules,
  appendEvent,
  transition,
  acceptInput,
  openReview,
  resolveReview,
  expireReviews,
} from "./match-integrity.js";
import { RoomManager } from "./rooms-manager.js";
import { rakeCentsForPot } from "./escrow.js";
import { TournamentEngine } from "./tournaments.js";
import { clanSystem } from "./clans.js";
import { replayEngine } from "./replays.js";
import {
  httpRateLimit,
  wsRateLimit,
  wsCleanup,
  wsUserRateLimit,
} from "./ratelimit.js";
import {
  assertAdminIpAllowed,
  assertAuthNotLocked,
  authLockKey,
  clearAuthFailures,
  clientIpFromReq,
  recordAuthFailure,
} from "./security.js";

const scrypt = promisify(crypto.scrypt),
  uuid = () => crypto.randomUUID();
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public",
);
const production = process.env.NODE_ENV === "production";
const simulation = !production && process.env.ENABLE_SIMULATED_FUNDS === "1";
const defaultHostedFactory = (options) => new HostedSession(options);
const graceMs = Number(process.env.RECONNECT_GRACE_MS) || 30000;
const send = (ws, data) => {
  if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 2097152)
    ws.send(JSON.stringify(data));
};
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const text = (v, max = 100) => {
  if (typeof v !== "string" || v.length > max)
    throw fail("Campo de texto inválido.");
  return v.trim();
};
const json = (res, status, value) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
};
const userView = (u) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  fullName: u.full_name,
  cpf: u.cpf,
  role: u.role,
  kycStatus: u.kyc_status,
  vipLevel: u.vip_level,
  elo: u.elo,
  wins: u.wins,
  losses: u.losses,
  isFrozen: !!u.is_frozen,
  isBanned: !!u.is_banned,
});
const adminUserView = (u) => {
  let address = {};
  try {
    address =
      typeof u.address === "object" && u.address
        ? u.address
        : JSON.parse(u.address || "{}");
  } catch {}
  return {
    ...userView(u),
    address,
    birthDate: u.birth_date || "",
    kycPhoto: u.kyc_photo || "",
    ip: u.ip || "",
    macFingerprint: u.mac_fp || "",
    location: u.location || "",
    fraudScore: "N/D",
    amlRisk: "Não avaliado",
  };
};
const walletView = (id) => {
  const w = id ? Wallets.get(id) : null;
  return {
    balanceCents: w?.balance || 0,
    locked: w?.locked || 0,
    balanceReais: ((w?.balance || 0) / 100).toFixed(2),
    lockedReais: ((w?.locked || 0) / 100).toFixed(2),
  };
};
async function hashPassword(p) {
  const salt = crypto.randomBytes(16).toString("hex");
  return salt + ":" + (await scrypt(p, salt, 64)).toString("hex");
}
async function verifyPassword(p, stored) {
  if (typeof p !== "string" || p.length > 256 || !stored?.includes(":"))
    return false;
  const [salt, h] = stored.split(":");
  const a = await scrypt(p, salt, 64),
    b = Buffer.from(h, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function body(req) {
  let n = 0;
  const chunks = [];
  for await (const c of req) {
    n += c.length;
    if (n > 1048576) throw fail("Requisição muito grande.", 413);
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw fail("JSON inválido.");
  }
}

export function startPlatform({
  port = Number(process.env.PORT) || 3000,
  host = process.env.HOST || "127.0.0.1",
  hostedFactory = defaultHostedFactory,
} = {}) {
  recoverMatches();
  const clients = new Map(),
    matches = new Map(),
    challenges = new Map(),
    hostedWaitQueue = []; // match ids aguardando slot server-stream
  const tournaments = new TournamentEngine();
  const hostedCap = () => Math.max(1, Number(process.env.HOSTED_MAX_SESSIONS) || 1);
  const hostedActiveCount = () =>
    [...matches.values()].filter(
      (m) =>
        m.rules?.transport === "server-stream" &&
        m.phase !== "QUEUED" &&
        (m.worker || m.workerReady || m.phase === "LOADING" || m.phase === "RUNNING"),
    ).length;
  const hostedBusy = () => hostedActiveCount() >= hostedCap();
  const manager = new RoomManager(
    db
      .prepare("SELECT payload FROM platform_rooms")
      .all()
      .map((r) => JSON.parse(r.payload)),
  );
  if (!manager.getAll().length)
    for (const region of ["Sudeste", "Nordeste", "Sul"])
      manager.create({
        name: `KOF 2002 — ${region}`,
        game: "KOF 2002",
        region,
        rakePercent: 10,
        createdBy: "SYSTEM",
      });
  const persistRooms = () =>
    db.transaction(() => {
      db.prepare("DELETE FROM platform_rooms").run();
      for (const r of manager.getAll())
        db.prepare("INSERT INTO platform_rooms(id,payload) VALUES(?,?)").run(
          r.id,
          JSON.stringify({ ...r, count: 0 }),
        );
    })();
  persistRooms();
  for (const [code, amount, max] of [
    ["KOFBRASIL", 500, 1000],
    ["ARENAVIP", 1000, 500],
  ])
    db.prepare(
      "INSERT OR IGNORE INTO coupons(code,amount_cents,max_uses) VALUES(?,?,?)",
    ).run(code, amount, max);
  const broadcast = (d, room = null) => {
    for (const [ws, c] of clients) if (!room || c.roomId === room) send(ws, d);
  };
  const connection = (id) =>
    [...clients].find(
      ([ws, c]) => c.userId === id && ws.readyState === WebSocket.OPEN,
    );
  const account = (c) => {
    const s = Sessions.validate(c.token);
    if (!s || s.user_id !== c.userId)
      throw fail("Sessão inválida ou expirada. Entre novamente.", 401);
    const u = Users.getById(s.user_id);
    if (u.is_frozen) throw fail("Conta congelada.", 403);
    return u;
  };
  const httpAccount = (req, admin = false) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization || "")?.[1],
      s = Sessions.validate(token);
    if (!s) throw fail("Não autorizado.", 401);
    const u = Users.getById(s.user_id);
    if (u.is_frozen || (admin && u.role !== "ADMIN"))
      throw fail("Acesso negado.", 403);
    if (admin) assertAdminIpAllowed(req);
    return u;
  };
  const roster = (room) =>
    [...clients.values()]
      .filter((c) => c.roomId === room && c.userId)
      .map((c) => {
        const u = Users.getById(c.userId);
        return {
          id: u.id,
          username: u.username,
          role: u.role,
          vipLevel: u.vip_level,
          elo: u.elo,
          device: c.device || "PC",
          controllerType: c.controllerType || "KEYBOARD",
          status: c.matchId
            ? "JOGANDO"
            : [...challenges.values()].some((ch) =>
                  [ch.from, ch.to].includes(u.id),
                )
              ? "DESAFIADO"
              : "LIVRE",
          currentMatchId: c.matchId,
          ping: c.ping || 0,
        };
      });
  const online = () => [...clients.values()].filter((c) => c.userId).length;
  const refresh = (room) => {
    for (const r of manager.getAll()) r.count = roster(r.id).length;
    if (room) broadcast({ type: "ROOM_USERS", users: roster(room) }, room);
    broadcast({ type: "ROOMS_UPDATED", rooms: manager.publicList() });
  };
  const walletUpdate = (id, message) =>
    send(connection(id)?.[0], {
      type: "WALLET_UPDATE",
      ...walletView(id),
      newElo: Users.getById(id).elo,
      message,
    });
  const payload = (m, id) => ({
    matchId: m.id,
    mode: m.mode,
    stakeReais: (m.stake / 100).toFixed(2),
    prizeReais: (m.prize / 100).toFixed(2),
    mySlot: m.a === id ? 1 : 2,
    phase: m.phase,
    playerA: { id: m.a, username: Users.getById(m.a).username },
    playerB: { id: m.b, username: Users.getById(m.b).username },
    transport: m.rules.transport,
    hostedReady: Boolean(m.workerReady),
    simulation,
    queuePosition: m.queuePosition || null,
    rules: m.rules,
    inputEpoch: connection(id)?.[1].input.epoch,
    nextInputSeq: (connection(id)?.[1].input.seq || 0) + 1,
  });
  const both = (m, d) => {
    for (const id of [m.a, m.b]) send(connection(id)?.[0], d);
  };
  const phase = (m, p) => {
    transition(m, p);
    m.phase = p;
  };
  function clearMatch(m) {
    m.worker?.stop().catch((error) => console.error("[HOSTED]", error.message));
    for (const t of m.grace.values()) clearTimeout(t);
    clearTimeout(m.deadline);
    clearTimeout(m.reportTimer);
    matches.delete(m.id);
    const qi = hostedWaitQueue.indexOf(m.id);
    if (qi >= 0) hostedWaitQueue.splice(qi, 1);
    for (const [, c] of clients) if (c.matchId === m.id) c.matchId = null;
    refresh(m.room);
    if (!closing) promoteHostedQueue();
  }
  function cancel(m, reason, dispute = false) {
    if (!m || !matches.has(m.id)) return;
    if (m.phase !== "LOADING" && m.phase !== "QUEUED")
      return review(m, "SYSTEM", reason);
    finance.cancelMatch(m.id, reason, dispute);
    appendEvent(m.id, "SYSTEM", "CANCELLED_BEFORE_START", { reason });
    both(m, {
      type: dispute ? "MATCH_DISPUTE" : "MATCH_CANCELLED",
      matchId: m.id,
      reason,
      message: reason,
    });
    for (const id of [m.a, m.b]) walletUpdate(id, reason);
    AuditLog.record(
      "SYSTEM",
      "SYSTEM",
      dispute ? "MATCH_DISPUTE" : "MATCH_CANCEL",
      m.id,
      { reason },
    );
    clearMatch(m);
  }
  function settle(m, winner) {
    if (!m || !matches.has(m.id) || m.phase === "REVIEW" || m.reviewLock)
      return;
    finance.settleMatch(m.id, winner);
    appendEvent(
      m.id,
      "SYSTEM",
      m.worker ? "SERVER_RESULT_SETTLED" : "DEMO_RESULT_SETTLED",
      {
        winner,
        authority: m.worker ? "server-session" : "dual-client-confirmation",
      },
    );
    both(m, {
      type: "MATCH_ENDED",
      matchId: m.id,
      winnerId: winner,
      winnerUsername: Users.getById(winner).username,
      prizeReais: (m.prize / 100).toFixed(2),
      rakeReais: (m.rake / 100).toFixed(2),
    });
    for (const id of [m.a, m.b]) walletUpdate(id, "Partida encerrada.");
    AuditLog.record("SYSTEM", "SYSTEM", "MATCH_SETTLE", m.id, { winner });
    clearMatch(m);
  }
  function review(m, actor, reason) {
    if (!matches.has(m.id) || m.phase === "REVIEW" || m.reviewLock) return;
    // Trava imediata em memória para bloquear onResult/settle concorrentes
    // antes da transação SQLite concluir.
    m.reviewLock = true;
    const { deadlineAt } = openReview(m, actor, reason);
    m.phase = "REVIEW";
    both(m, {
      type: "MATCH_REVIEW_OPENED",
      matchId: m.id,
      reason,
      deadlineAt,
      message:
        "Partida em análise. Reservas preservadas até decisão ou prazo de revisão.",
    });
    for (const id of [m.a, m.b])
      walletUpdate(id, "Partida em análise; consulte o histórico de revisões.");
    clearMatch(m);
  }
  function promoteHostedQueue() {
    while (!hostedBusy() && hostedWaitQueue.length) {
      const nextId = hostedWaitQueue.shift();
      const m = matches.get(nextId);
      if (!m || m.phase !== "QUEUED") continue;
      m.queuePosition = null;
      try {
        phase(m, "LOADING");
      } catch (error) {
        cancel(m, "Falha ao liberar fila hospedada: " + error.message);
        continue;
      }
      m.deadline = setTimeout(
        () =>
          cancel(m, "Tempo de preparação esgotado. Reservas devolvidas."),
        Number(process.env.MATCH_LOADING_MS) || 180000,
      );
      both(m, {
        type: "HOSTED_DEQUEUED",
        matchId: m.id,
        message: "Sessão liberada. Preparando a partida oficial.",
      });
      for (const id of [m.a, m.b])
        send(connection(id)?.[0], { type: "MATCH_STARTED", ...payload(m, id) });
      launchHosted(m);
      break;
    }
    for (let i = 0; i < hostedWaitQueue.length; i++) {
      const queued = matches.get(hostedWaitQueue[i]);
      if (!queued) continue;
      queued.queuePosition = i + 1;
      both(queued, {
        type: "HOSTED_QUEUED",
        matchId: queued.id,
        position: i + 1,
        message: `Aguardando sessão oficial. Posição ${i + 1} na fila.`,
      });
    }
  }
  function publishReviewDecision(result) {
    if (result.repeated || !result.match) return;
    for (const id of [result.match.player_a_id, result.match.player_b_id]) {
      walletUpdate(id, "Revisão encerrada. Consulte o histórico da partida.");
      send(connection(id)?.[0], {
        type: "MATCH_REVIEW_CLOSED",
        matchId: result.match.id,
      });
    }
  }
  function challengeEnd(ch, reason) {
    clearTimeout(ch.timer);
    challenges.delete(ch.id);
    for (const id of [ch.from, ch.to])
      send(connection(id)?.[0], {
        type: "CHALLENGE_EXPIRED",
        challengeId: ch.id,
        message: reason,
      });
    refresh(ch.room);
  }
  function member(c, d) {
    const u = account(c),
      m = matches.get(d.matchId);
    if (!m || ![m.a, m.b].includes(u.id) || c.matchId !== m.id)
      throw fail("Você não participa desta partida.", 403);
    return { u, m, other: u.id === m.a ? m.b : m.a };
  }

  function startIfReady(m) {
    if (
      m.phase !== "LOADING" ||
      m.ready.size !== 2 ||
      (m.worker && (!m.workerReady || m.mediaConnected.size !== 2))
    )
      return;
    phase(m, "RUNNING");
    clearTimeout(m.deadline);
    m.deadline = setTimeout(
      () => cancel(m, "Tempo máximo de partida esgotado."),
      m.rules.durationMs,
    );
    m.worker?.resume().catch((error) => cancel(m, error.message));
    both(m, { type: "GAME_RUNNING", matchId: m.id });
  }

  async function launchHosted(m) {
    try {
      m.worker = hostedFactory({
        matchId: m.id,
        onProgress: (stage) => {
          if (
            matches.has(m.id) &&
            ["assets", "runtime", "boot", "credits"].includes(stage)
          )
            both(m, { type: "HOSTED_PROGRESS", matchId: m.id, stage });
        },
        onPeer: (slot, state) => {
          if (!matches.has(m.id)) return;
          if (state === "connected") m.mediaConnected.add(slot);
          else m.mediaConnected.delete(slot);
          if (m.mediaConnected.size === 2) {
            if (m.phase === "LOADING")
              m.worker.resume().catch((error) => cancel(m, error.message));
            startIfReady(m);
            if (m.phase === "RUNNING" && m.grace.size === 0)
              m.worker.resume().catch((error) => cancel(m, error.message));
          } else if (m.phase === "RUNNING")
            m.worker.pause().catch((error) => cancel(m, error.message));
        },
        onSignal: (slot, signal) => {
          if (matches.has(m.id))
            send(connection(slot === 1 ? m.a : m.b)?.[0], {
              type: "MATCH_SIGNAL",
              matchId: m.id,
              signal,
              fromSlot: 0,
            });
        },
        onFailure: (message) =>
          cancel(m, "Falha da execução oficial: " + message),
        onSample: (sample) => {},
        onObservation: (observation) => {
          if (matches.has(m.id))
            appendEvent(
              m.id,
              "SERVER_WORKER",
              observation.event,
              observation.sample,
            );
        },
        onResult: (proof) => {
          if (
            !matches.has(m.id) ||
            m.reviewLock ||
            m.phase !== "RUNNING" ||
            ![1, 2].includes(proof.winnerSlot)
          )
            return;
          appendEvent(m.id, "SERVER_WORKER", "SERVER_RESULT", proof);
          settle(m, proof.winnerSlot === 1 ? m.a : m.b);
        },
        onMetrics: (metrics) => {
          if (matches.has(m.id))
            both(m, { type: "HOSTED_METRICS", matchId: m.id, metrics });
        },
        iceServers: JSON.parse(process.env.HOSTED_ICE_SERVERS || "[]"),
      });
      const result = await m.worker.start();
      if (!matches.has(m.id)) return m.worker.stop();
      m.workerReady = true;
      appendEvent(m.id, "SERVER_WORKER", "WORKER_READY", {
        manifest: result.manifest,
      });
      both(m, { type: "HOSTED_READY", matchId: m.id });
      startIfReady(m);
    } catch (error) {
      cancel(m, "A execução oficial não iniciou: " + error.message);
    }
  }

  const server = http.createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "X-Frame-Options",
      req.url.split("?")[0] === "/emulator.html" ? "SAMEORIGIN" : "DENY",
    );
    res.setHeader("Referrer-Policy", "same-origin");
    httpRateLimit(req, res, async () => {
      try {
        const url = new URL(req.url, "http://localhost"),
          p = url.pathname;
        if (req.method === "OPTIONS") {
          res.writeHead(204);
          return res.end();
        }
        if (p === "/health")
          return json(res, 200, {
            status: "ok",
            version: "13.0",
            activeMatches: matches.size,
            onlineUsers: online(),
            reconciliation: finance.reconcile().ok,
          });
        if (p === "/api/config")
          return json(res, 200, {
            simulation,
            transport: "host-stream",
            game: "kof2002",
            resultMode: "dual-confirmation",
            inputProtocol: 2,
            creditTransport: "server-stream",
            hostedConfigured: fs.existsSync(
              path.resolve(
                process.env.HOSTED_GAME_DIR ||
                  path.join(root, "../data/hosted/kof2002"),
                "manifest.json",
              ),
            ),
            hostedMaxSessions: hostedCap(),
            hostedActiveSessions: hostedActiveCount(),
            hostedQueueLength: hostedWaitQueue.length,
            realMoneyEnabled: false,
            disputeMode: "review-with-deadline",
            reconnectMs: graceMs,
          });
        if (p === "/api/rooms") return json(res, 200, manager.publicList());
        if (p === "/api/tournaments")
          return json(res, 200, tournaments.getAllTournaments());
        if (p === "/api/clans")
          return json(res, 200, clanSystem.getLeaderboard());
        if (p === "/api/replays")
          return json(res, 200, replayEngine.listRecentReplays());
        if (p === "/api/leaderboard")
          return json(res, 200, {
            leaderboard: db
              .prepare(
                "SELECT id,username,elo,wins,losses,vip_level AS vipLevel FROM users WHERE is_banned=0 ORDER BY elo DESC LIMIT 100",
              )
              .all(),
          });
        if (p === "/api/matches/live")
          return json(res, 200, {
            matches: [...matches.values()].map((m) => ({
              matchId: m.id,
              playerA: Users.getById(m.a).username,
              playerB: Users.getById(m.b).username,
              roomId: m.room,
              mode: m.mode,
              stakeReais: (m.stake / 100).toFixed(2),
              spectators: 0,
            })),
          });
        if (p === "/api/matches/recent")
          return json(res, 200, {
            matches: db
              .prepare(
                "SELECT m.*,a.username p1_name,b.username p2_name FROM matches m JOIN users a ON a.id=m.player_a_id JOIN users b ON b.id=m.player_b_id ORDER BY started_at DESC LIMIT 20",
              )
              .all(),
          });
        const integrityRoute = /^\/api\/matches\/([^/]+)\/integrity$/.exec(p);
        if (integrityRoute && req.method === "GET") {
          const u = httpAccount(req),
            match = db
              .prepare("SELECT * FROM matches WHERE id=?")
              .get(integrityRoute[1]);
          if (
            !match ||
            (u.role !== "ADMIN" &&
              ![match.player_a_id, match.player_b_id].includes(u.id))
          )
            throw fail("Acesso negado.", 403);
          return json(res, 200, {
            rules: JSON.parse(
              db
                .prepare("SELECT payload FROM match_rules WHERE match_id=?")
                .get(match.id)?.payload || "null",
            ),
            review:
              db
                .prepare("SELECT * FROM match_reviews WHERE match_id=?")
                .get(match.id) || null,
            events: db
              .prepare(
                "SELECT * FROM match_events WHERE match_id=? AND seq>? ORDER BY seq LIMIT 500",
              )
              .all(
                match.id,
                Math.max(0, Number(url.searchParams.get("after")) || 0),
              ),
          });
        }
        if (p === "/api/my-reviews" && req.method === "GET") {
          const u = httpAccount(req);
          return json(res, 200, {
            reviews: db
              .prepare(
                "SELECT r.*,m.player_a_id,m.player_b_id,m.stake_cents FROM match_reviews r JOIN matches m ON m.id=r.match_id WHERE m.player_a_id=? OR m.player_b_id=? ORDER BY r.opened_at DESC LIMIT 100",
              )
              .all(u.id, u.id),
          });
        }
        if (p === "/api/stats/daily")
          return json(res, 200, {
            matches: Stats.daily(7),
            users: Stats.newUsers(7),
          });
        if (p === "/api/logout" && req.method === "POST") {
          httpAccount(req);
          const token = req.headers.authorization.slice(7);
          Sessions.destroy(token);
          for (const [ws, c] of clients)
            if (c.token === token) ws.close(4001, "Sessão encerrada");
          return json(res, 200, { ok: true });
        }
        if (p === "/api/transactions") {
          const u = httpAccount(req),
            id = url.searchParams.get("userId") || u.id;
          if (id !== u.id && u.role !== "ADMIN")
            throw fail("Acesso negado.", 403);
          return json(res, 200, {
            transactions: Transactions.forUser(id).map((t) => ({
              ...t,
              amount: (t.amount_cents / 100).toFixed(2),
              desc: t.description,
              ts: t.created_at,
            })),
            ...walletView(id),
          });
        }
        if (p === "/api/coupon/redeem" && req.method === "POST") {
          const u = httpAccount(req);
          if (!simulation)
            throw fail("Promoções desativadas neste ambiente.", 403);
          const d = await body(req);
          if (d.userId && d.userId !== u.id) throw fail("Acesso negado.", 403);
          finance.redeem(u.id, text(d.code, 30).toUpperCase());
          walletUpdate(u.id);
          return json(res, 200, {
            success: true,
            newBalanceReais: walletView(u.id).balanceReais,
            message: "Cupom aplicado.",
          });
        }
        if (p === "/api/matchmaking/join" && req.method === "POST") {
          httpAccount(req);
          throw fail(
            "Matchmaking automático desativado. Entre na sala KOF 2002 e desafie o oponente.",
            501,
          );
        }
        if (
          p.startsWith("/api/matchmaking/leave/") &&
          req.method === "DELETE"
        ) {
          const u = httpAccount(req);
          MatchmakingQueue.leave(u.id);
          return json(res, 200, {
            ok: true,
            message: "Matchmaking automático desativado.",
          });
        }
        if (p.startsWith("/api/admin/")) {
          const admin = httpAccount(req, true);
          if (p === "/api/admin/match-reviews" && req.method === "GET")
            return json(res, 200, {
              reviews: db
                .prepare(
                  "SELECT r.*,a.username player_a,b.username player_b,m.stake_cents FROM match_reviews r JOIN matches m ON m.id=r.match_id JOIN users a ON a.id=m.player_a_id JOIN users b ON b.id=m.player_b_id ORDER BY r.opened_at DESC LIMIT 100",
                )
                .all(),
            });
          const decisionRoute = /^\/api\/admin\/match-reviews\/([^/]+)$/.exec(
            p,
          );
          if (decisionRoute && req.method === "POST") {
            const d = await body(req);
            const result = resolveReview(
              decisionRoute[1],
              admin.id,
              d.decision,
              d.reason,
            );
            publishReviewDecision(result);
            return json(res, 200, { ok: true, repeated: result.repeated });
          }
          if (p === "/api/admin/overview") {
            const s = Wallets.allBalanceSummary(),
              rake = finance.treasury(),
              pending = PendingWithdrawals.pending(),
              money = (n) => ((n || 0) / 100).toFixed(2);
            return json(res, 200, {
              vault: {
                totalCompanyCapitalReais: money(rake),
                platformRakeProfitReais: money(rake),
                activeInPlayReais: money(s.totalFlow),
                lockedEscrowReais: money(s.totalEscrow),
                pendingWithdrawalsReais: money(
                  pending.reduce((n, r) => n + r.amount_cents, 0),
                ),
                totalDepositsReais: money(s.totalDeposits),
                totalWithdrawalsReais: money(s.totalWithdrawals),
              },
              dre: {
                volumeBrutoTransacionado: money(s.totalDeposits),
                receitaBrutaRake: money(rake),
                custosGatewayPix: "0.00",
                fundoProtecaoReserva: "0.00",
                resultadoLiquidoOperacional: money(rake),
              },
              stats: {
                totalUsers: Users.all().length,
                onlineNow: online(),
                activeMatches: matches.size,
                totalMatchesAllTime: db
                  .prepare("SELECT COUNT(*) n FROM matches")
                  .get().n,
                openTickets: 0,
              },
              pendingKyc: Users.pendingKyc().map(adminUserView),
              pendingWithdrawals: pending.map((r) => ({
                id: r.id,
                userId: r.user_id,
                username: r.username,
                cpf: r.cpf,
                amountCents: r.amount_cents,
                amountReais: money(r.amount_cents),
                pixKey: r.pix_key,
                status: r.status,
                requestedAt: r.requested_at,
                fraudScore: "N/D",
              })),
              allUsers: Users.all().map((u) => ({
                ...adminUserView(u),
                ...walletView(u.id),
                createdAt: u.created_at,
              })),
              rooms: manager.adminList(),
              ledger: db
                .prepare(
                  "SELECT * FROM transactions ORDER BY id DESC LIMIT 100",
                )
                .all()
                .map((t) => ({
                  id: t.id,
                  type: t.type,
                  userId: t.user_id,
                  amountReais: money(t.amount_cents),
                  balanceAfterReais: money(t.balance_after),
                  timestamp: t.created_at,
                })),
              reconciliation: finance.reconcile(),
              simulation,
            });
          }
          if (p === "/api/admin/stats")
            return json(res, 200, {
              matches: Stats.daily(7),
              users: Stats.newUsers(7),
            });
          if (p === "/api/admin/audit-log")
            return json(res, 200, {
              log: AuditLog.recent(
                Math.min(
                  500,
                  Math.max(1, Number(url.searchParams.get("limit")) || 100),
                ),
              ),
            });
          if (p === "/api/admin/reconciliation")
            return json(res, 200, finance.reconcile());
          if (p === "/api/admin/export-csv") {
            const rows = db
              .prepare("SELECT * FROM transactions ORDER BY id DESC")
              .all();
            res.writeHead(200, {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": 'attachment; filename="extrato.csv"',
            });
            return res.end(
              "id,data,tipo,usuario,centavos,saldo\n" +
                rows
                  .map((r) =>
                    [
                      r.id,
                      r.created_at,
                      r.type,
                      r.user_id,
                      r.amount_cents,
                      r.balance_after,
                    ]
                      .map((x) => '"' + String(x).replaceAll('"', '""') + '"')
                      .join(","),
                  )
                  .join("\n"),
            );
          }
          if (p === "/api/admin/action" && req.method === "POST") {
            const d = await body(req),
              u =
                Users.getById(d.userId) ||
                db
                  .prepare("SELECT * FROM users WHERE username=?")
                  .get(d.userId);
            if (!u) throw fail("Usuário não encontrado.", 404);
            db.transaction(() => {
              if (d.action === "ADD_BALANCE")
                finance.credit(
                  u.id,
                  cents(d.amountCents),
                  "ADMIN_CREDIT",
                  uuid(),
                  text(d.reason || "Ajuste administrativo", 200),
                );
              else if (d.action === "DEDUCT_BALANCE")
                finance.adjust(
                  u.id,
                  cents(d.amountCents),
                  uuid(),
                  text(d.reason || "Ajuste administrativo", 200),
                );
              else if (["BAN", "UNBAN"].includes(d.action)) {
                Users.ban(u.id, d.action === "BAN");
                if (d.action === "BAN") Sessions.destroyUser(u.id);
              } else if (d.action === "FREEZE")
                Users.freeze(u.id, !u.is_frozen);
              else if (d.action === "RESET_ELO")
                db.prepare(
                  "UPDATE users SET elo=1200,wins=0,losses=0 WHERE id=?",
                ).run(u.id);
              else if (d.action === "SET_ROLE") {
                if (!["USER", "MODERATOR", "ADMIN"].includes(d.role))
                  throw fail("Papel inválido.");
                db.prepare("UPDATE users SET role=? WHERE id=?").run(
                  d.role,
                  u.id,
                );
                Sessions.destroyUser(u.id);
              } else if (["APPROVE_KYC", "REJECT_KYC"].includes(d.action))
                Users.updateKyc(
                  u.email,
                  d.action === "APPROVE_KYC" ? "APROVADO" : "REJEITADO",
                  u.kyc_photo,
                );
              else throw fail("Ação não suportada.");
              AuditLog.record(admin.id, "ADMIN", d.action, u.id, {
                reason: d.reason || "",
                amountCents: d.amountCents || 0,
              });
            })();
            if (["BAN", "FREEZE", "SET_ROLE"].includes(d.action))
              for (const [ws, c] of clients)
                if (c.userId === u.id) {
                  cancel(
                    matches.get(c.matchId),
                    "Conta alterada pela administração.",
                  );
                  ws.close(4001, "Permissões alteradas");
                }
            walletUpdate(u.id);
            refresh(connection(u.id)?.[1].roomId);
            return json(res, 200, { success: true });
          }
          if (
            [
              "/api/admin/withdrawal/approve",
              "/api/admin/withdrawal/reject",
            ].includes(p) &&
            req.method === "POST"
          ) {
            if (!simulation && p.endsWith("/approve"))
              throw fail("PIX indisponível: provedor não integrado.", 409);
            const d = await body(req),
              r = db.transaction(() => {
                const r = finance.resolveWithdrawal(
                  d.withdrawalId,
                  p.endsWith("/approve"),
                );
                if (!r.repeated)
                  AuditLog.record(
                    admin.id,
                    "ADMIN",
                    "WITHDRAWAL_DECISION",
                    d.withdrawalId,
                    { approve: p.endsWith("/approve") },
                  );
                return r;
              })();
            walletUpdate(r.row.user_id);
            return json(res, 200, { success: true, repeated: r.repeated });
          }
          if (p === "/api/admin/coupons")
            return json(res, 200, {
              coupons: db
                .prepare(
                  "SELECT c.*,amount_cents AS amountCents,max_uses AS maxUses,(SELECT COUNT(*) FROM coupon_redemptions r WHERE r.code=c.code) used FROM coupons c",
                )
                .all(),
            });
          if (p === "/api/admin/coupon" && req.method === "POST") {
            const d = await body(req),
              code = text(d.code, 30).toUpperCase();
            if (!/^[A-Z0-9_-]{3,30}$/.test(code))
              throw fail("Código inválido.");
            db.prepare(
              "INSERT INTO coupons(code,amount_cents,max_uses) VALUES(?,?,?)",
            ).run(
              code,
              cents(d.amountCents),
              cents(d.maxUses, { max: 100000 }),
            );
            return json(res, 200, { success: true });
          }
          if (p === "/api/admin/broadcast" && req.method === "POST") {
            const d = await body(req);
            broadcast(
              { type: "SYSTEM_MESSAGE", text: "📢 " + text(d.message, 300) },
              d.roomId || null,
            );
            return json(res, 200, { success: true });
          }
          if (p === "/api/admin/rooms" && req.method === "POST") {
            const r = manager.create({
              ...(await body(req)),
              createdBy: admin.id,
            });
            persistRooms();
            refresh();
            return json(res, 200, { success: true, room: r });
          }
          const mod =
            /^\/api\/admin\/rooms\/([^/]+)\/moderators(?:\/([^/]+))?$/.exec(p);
          if (mod) {
            if (req.method === "POST") {
              const d = await body(req),
                u = Users.getById(d.userId);
              if (!u) throw fail("Conta não encontrada.", 404);
              manager.addModerator(mod[1], {
                userId: u.id,
                username: u.username,
                addedBy: admin.id,
              });
            } else if (req.method === "DELETE" && mod[2])
              manager.removeModerator(mod[1], mod[2]);
            else throw fail("Método inválido.", 405);
            persistRooms();
            refresh(mod[1]);
            return json(res, 200, { success: true });
          }
          const rm = /^\/api\/admin\/rooms\/([^/]+)(\/toggle)?$/.exec(p);
          if (rm) {
            if (req.method === "PUT") manager.update(rm[1], await body(req));
            else if (req.method === "POST" && rm[2]) manager.toggle(rm[1]);
            else if (req.method === "DELETE") {
              if ([...matches.values()].some((m) => m.room === rm[1]))
                throw fail("Sala possui partida ativa.", 409);
              manager.delete(rm[1]);
            } else throw fail("Método inválido.", 405);
            persistRooms();
            refresh();
            return json(res, 200, { success: true });
          }
          throw fail("Endpoint administrativo não implementado.", 404);
        }
        if (p.startsWith("/api/")) throw fail("Endpoint não encontrado.", 404);
        if (!["GET", "HEAD"].includes(req.method))
          throw fail("Método não permitido.", 405);
        const decoded = decodeURIComponent(req.url.split("?")[0]);
        if (
          decoded.includes("\\") ||
          decoded.includes("\0") ||
          decoded.split("/").includes("..")
        )
          throw fail("Caminho inválido.", 403);
        const candidate = path.resolve(
          root,
          "." + (decoded === "/" ? "/index.html" : decoded),
        );
        if (!candidate.startsWith(root + path.sep))
          throw fail("Caminho inválido.", 403);
        let real;
        try {
          real = await fs.promises.realpath(candidate);
        } catch {
          throw fail("Arquivo não encontrado.", 404);
        }
        if (!real.startsWith(root + path.sep))
          throw fail("Caminho inválido.", 403);
        const stat = await fs.promises.stat(real);
        if (!stat.isFile()) throw fail("Arquivo não encontrado.", 404);
        const ext = path.extname(real),
          mime = {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".css": "text/css",
            ".json": "application/json",
            ".wasm": "application/wasm",
            ".png": "image/png",
            ".svg": "image/svg+xml",
            ".zip": "application/zip",
          };
        res.writeHead(200, {
          "Content-Type": mime[ext] || "application/octet-stream",
          "Cache-Control": "no-cache",
          "Content-Length": stat.size,
        });
        if (req.method === "HEAD") return res.end();
        const stream = fs.createReadStream(real);
        stream.on("error", () => res.destroy());
        stream.pipe(res);
      } catch (e) {
        if (!res.headersSent) json(res, e.status || 400, { error: e.message });
        else res.destroy();
      }
    });
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const origin = req.headers.origin;
    let valid = !origin && !production;
    if (origin) {
      try {
        valid =
          new URL(origin).host === req.headers.host ||
          origin === process.env.ALLOWED_ORIGIN;
      } catch {}
    }
    if (
      !valid ||
      !["/", "/ws"].includes(new URL(req.url, "http://localhost").pathname)
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  });
  wss.on("connection", (ws, req) => {
    const c = {
      userId: null,
      token: null,
      roomId: null,
      matchId: null,
      alive: true,
      input: { epoch: uuid(), seq: 0, pressed: new Set() },
    };
    clients.set(ws, c);
    send(ws, {
      type: "INIT_SESSION",
      user: { id: null, username: "Visitante", role: "GUEST" },
      wallet: walletView(null),
      rooms: manager.publicList(),
      simulation,
    });
    ws.on("pong", () => (c.alive = true));
    ws.on("error", () => {});
    let chain = Promise.resolve(),
      pending = 0;
    ws.on("message", (raw) => {
      if (++pending > 256) {
        ws.close(1008, "Fila excedida");
        return;
      }
      chain = chain
        .then(async () => {
          try {
            if (clients.get(ws) !== c || ws.readyState !== WebSocket.OPEN)
              return;
            let d;
            try {
              d = JSON.parse(raw.toString());
            } catch {
              throw fail("Mensagem JSON inválida.");
            }
            if (
              !d ||
              typeof d !== "object" ||
              Array.isArray(d) ||
              typeof d.type !== "string"
            )
              throw fail("Mensagem inválida.");
            if (
              !wsRateLimit(ws, d.type) ||
              !wsUserRateLimit(c.userId || req.socket.remoteAddress, d.type)
            )
              throw fail("Muitas ações. Aguarde.", 429);
            if (
              ["LOGIN_ACCOUNT", "REGISTER_ACCOUNT", "REAUTH"].includes(d.type)
            ) {
              if (c.matchId)
                throw fail("Finalize a partida antes de trocar a sessão.");
              let u, token;
              const peerIp = clientIpFromReq(req);
              if (d.type === "REAUTH") {
                const s = Sessions.validate(d.token);
                if (!s) throw fail("Sessão inválida ou expirada.", 401);
                u = Users.getById(s.user_id);
                token = d.token;
              } else {
                const email = text(d.email, 254).toLowerCase(),
                  password = d.password;
                const lockKey = authLockKey(peerIp, email);
                assertAuthNotLocked(lockKey);
                if (!/^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email))
                  throw fail("E-mail inválido.");
                if (typeof password !== "string" || password.length > 256)
                  throw fail("Senha inválida.");
                if (d.type === "REGISTER_ACCOUNT") {
                  const username = text(d.username, 24);
                  if (!/^[\p{L}\p{N}_ .-]{3,24}$/u.test(username))
                    throw fail(
                      "Nick: de 3 a 24 letras, números, espaços, ponto, hífen ou _.",
                    );
                  if (password.length < 8)
                    throw fail("Senha mínima de oito caracteres.");
                  if (
                    Users.get(email) ||
                    db
                      .prepare("SELECT 1 FROM users WHERE username=?")
                      .get(username)
                  ) {
                    recordAuthFailure(lockKey);
                    throw fail("E-mail ou nick já cadastrado.");
                  }
                  const id = "usr_" + uuid();
                  Users.create({
                    id,
                    username,
                    email,
                    password: await hashPassword(password),
                    role: "USER",
                  });
                  u = Users.getById(id);
                  if (simulation)
                    finance.credit(
                      id,
                      2000,
                      "TEST_CREDIT",
                      "welcome:" + id,
                      "Créditos de teste, sem valor monetário",
                    );
                  clearAuthFailures(lockKey);
                } else {
                  u = Users.get(email);
                  if (!u || !(await verifyPassword(password, u.password))) {
                    recordAuthFailure(lockKey);
                    throw fail("E-mail ou senha inválidos.", 401);
                  }
                  clearAuthFailures(lockKey);
                }
                if (u.is_banned || u.is_frozen)
                  throw fail("Conta indisponível.", 403);
                if (u.role === "ADMIN") assertAdminIpAllowed(req);
                token = crypto.randomBytes(32).toString("hex");
                Sessions.create(token, u.id, u.email, u.role);
              }
              if (u.is_frozen) throw fail("Conta congelada.", 403);
              for (const [old, other] of clients)
                if (old !== ws && other.userId === u.id) {
                  other.superseded = true;
                  other.matchId = null;
                  old.close(4000, "Conta aberta em outra conexão");
                  clients.delete(old);
                }
              c.userId = u.id;
              c.token = token;
              const m = [...matches.values()].find((m) =>
                [m.a, m.b].includes(u.id),
              );
              if (m) {
                appendEvent(m.id, u.id, "RECONNECTED");
                clearTimeout(m.grace.get(u.id));
                m.grace.delete(u.id);
                c.matchId = m.id;
                c.roomId = m.room;
              }
              send(ws, {
                type: "AUTH_SUCCESS",
                user: { ...userView(u), currentMatchId: c.matchId },
                sessionToken: token,
                wallet: walletView(u.id),
                message: "Conectado.",
              });
              if (m) {
                send(ws, { type: "MATCH_RESUMED", ...payload(m, u.id) });
                both(m, {
                  type: "PEER_RECONNECTED",
                  matchId: m.id,
                  userId: u.id,
                });
              }
              refresh(c.roomId);
              return;
            }
            if (d.type === "PING") {
              send(ws, {
                type: "PONG",
                timestamp: d.timestamp,
                pingId: d.pingId,
              });
              return;
            }
            if (d.type === "PONG") return;
            if (d.type === "JOIN_ROOM") {
              if (c.matchId) throw fail("Você já está em uma partida.");
              const room = manager.getById(d.roomId);
              if (!room?.active) throw fail("Sala não encontrada.");
              if (room.password && room.password !== d.password)
                throw fail("Senha incorreta.");
              if (room.count >= room.maxPlayers && c.roomId !== room.id)
                throw fail("Sala lotada.");
              const old = c.roomId;
              c.roomId = room.id;
              send(ws, {
                type: "ROOM_JOINED",
                roomId: room.id,
                roomName: room.name,
                users: roster(room.id),
              });
              refresh(old);
              refresh(room.id);
              return;
            }
            const u = account(c);
            if (d.type === "LEAVE_ROOM") {
              if (c.matchId) throw fail("Cancele a partida antes de sair.");
              const old = c.roomId;
              c.roomId = null;
              refresh(old);
              return;
            }
            if (d.type === "SET_PROFILE") {
              c.device = ["PC", "MOBILE", "CONSOLE"].includes(d.device)
                ? d.device
                : "PC";
              c.controllerType = ["KEYBOARD", "GAMEPAD", "TOUCH"].includes(
                d.controllerType,
              )
                ? d.controllerType
                : "KEYBOARD";
              refresh(c.roomId);
              return;
            }
            if (d.type === "SEND_CHAT") {
              if (!c.roomId) throw fail("Entre em uma sala.");
              broadcast(
                {
                  type: "CHAT_MESSAGE",
                  senderId: u.id,
                  username: u.username,
                  device: c.device || "PC",
                  text: text(d.text, 300),
                  timestamp: new Date().toLocaleTimeString("pt-BR"),
                },
                c.roomId,
              );
              return;
            }
            if (d.type === "DEPOSIT_PIX") {
              if (!simulation)
                throw fail("PIX real ainda não está integrado.", 409);
              finance.credit(
                u.id,
                cents(d.amountCents),
                "TEST_CREDIT",
                uuid(),
                "Créditos de teste",
              );
              walletUpdate(u.id, "Créditos de teste adicionados.");
              return;
            }
            if (d.type === "SPIN_LUCKY_WHEEL")
              throw fail("Roleta indisponível.");
            if (d.type === "WITHDRAW_PIX") {
              if (!simulation)
                throw fail(
                  "Saques PIX reais ainda não estão habilitados.",
                  409,
                );
              if (u.kyc_status !== "APROVADO")
                throw fail("KYC obrigatório para saque.");
              const ref = finance.requestWithdrawal(
                u.id,
                cents(d.amountCents),
                d.pixKey,
              );
              walletUpdate(u.id);
              send(ws, {
                type: "SYSTEM_MESSAGE",
                text: `Saque #${ref} aguardando análise.`,
                withdrawalId: ref,
              });
              return;
            }
            if (d.type === "SUBMIT_FACIAL_KYC") {
              const photo = text(d.photoBase64, 400000);
              if (
                !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(
                  photo,
                )
              )
                throw fail("Imagem KYC inválida.");
              Users.updateKyc(u.email, "PENDENTE", photo);
              send(ws, {
                type: "KYC_STATUS_UPDATED",
                kycStatus: "PENDENTE",
                message: "Documento recebido para análise manual.",
              });
              return;
            }
            if (d.type === "ADMIN_DECIDE_KYC") {
              if (u.role !== "ADMIN") throw fail("Acesso negado.", 403);
              assertAdminIpAllowed(req);
              if (!["APROVADO", "REJEITADO"].includes(d.decision))
                throw fail("Decisão inválida.");
              const target = Users.get(text(d.userEmail, 254));
              if (!target) throw fail("Conta não encontrada.", 404);
              db.transaction(() => {
                Users.updateKyc(target.email, d.decision, target.kyc_photo);
                AuditLog.record(u.id, "ADMIN", "KYC_DECISION", target.id, {
                  decision: d.decision,
                });
              })();
              send(connection(target.id)?.[0], {
                type: "KYC_STATUS_UPDATED",
                kycStatus: d.decision,
                message: "Análise KYC atualizada.",
              });
              return;
            }
            if (d.type === "SEND_CHALLENGE") {
              const target = connection(d.targetUserId),
                room = manager.getById(c.roomId);
              if (!room?.active || !target || target[1].roomId !== c.roomId)
                throw fail("O jogador precisa estar conectado à mesma sala.");
              if (u.id === d.targetUserId)
                throw fail("Escolha outra conta para jogar.");
              if (
                c.matchId ||
                target[1].matchId ||
                [...challenges.values()].some((ch) =>
                  [ch.from, ch.to].some((id) =>
                    [u.id, d.targetUserId].includes(id),
                  ),
                )
              )
                throw fail("Já existe desafio ou partida em andamento.");
              account(target[1]);
              if (!["AMISTOSO", "APOSTADO"].includes(d.mode))
                throw fail("Modo inválido.");
              if (d.mode === "APOSTADO" && !simulation)
                throw fail(
                  "Partidas com saldo disponíveis somente no ambiente de teste.",
                  409,
                );
              if (d.mode === "APOSTADO") {
                if (room.game !== "KOF 2002")
                  throw fail(
                    "Este jogo ainda não possui perfil de execução oficial validado.",
                    409,
                  );
                // Verify before issuing an invitation or reserving either wallet.
                // Se o servidor estiver cheio, o accept entra na fila HOSTED.
                if (hostedFactory === defaultHostedFactory)
                  verifyHostedAssets();
              }
              const stake =
                d.mode === "APOSTADO"
                  ? cents(d.stakeCents, { max: 100000 })
                  : 0;
              if (
                stake &&
                (Wallets.get(u.id).balance < stake ||
                  Wallets.get(d.targetUserId).balance < stake)
              )
                throw fail("Um dos jogadores não possui saldo suficiente.");
              const ch = {
                id: "chal_" + uuid(),
                from: u.id,
                to: d.targetUserId,
                room: c.roomId,
                mode: d.mode,
                stake,
                expires: Date.now() + 30000,
              };
              ch.timer = setTimeout(
                () => challengeEnd(ch, "Desafio expirado."),
                30000,
              );
              challenges.set(ch.id, ch);
              send(target[0], {
                type: "CHALLENGE_RECEIVED",
                challengeId: ch.id,
                from: { id: u.id, username: u.username, elo: u.elo },
                mode: ch.mode,
                stakeCents: stake,
                stakeReais: (stake / 100).toFixed(2),
              });
              send(ws, {
                type: "CHALLENGE_SENT",
                challengeId: ch.id,
                targetUsername: Users.getById(ch.to).username,
              });
              refresh(ch.room);
              return;
            }
            if (d.type === "DECLINE_CHALLENGE") {
              const ch = challenges.get(d.challengeId);
              if (!ch || ![ch.from, ch.to].includes(u.id))
                throw fail("Desafio não encontrado.");
              challengeEnd(ch, "Desafio recusado.");
              return;
            }
            if (d.type === "ACCEPT_CHALLENGE") {
              const ch = challenges.get(d.challengeId);
              if (!ch || ch.to !== u.id || ch.expires < Date.now())
                throw fail("Desafio inválido ou expirado.");
              if (
                (d.stakeCents !== undefined && d.stakeCents !== ch.stake) ||
                (d.mode !== undefined && d.mode !== ch.mode) ||
                (d.fromUserId !== undefined && d.fromUserId !== ch.from)
              )
                throw fail("Dados do convite foram alterados.");
              const from = connection(ch.from);
              if (
                !from ||
                from[1].roomId !== ch.room ||
                c.roomId !== ch.room ||
                c.matchId ||
                from[1].matchId
              )
                throw fail("Jogador indisponível.");
              account(from[1]);
              if (
                ch.mode === "APOSTADO" &&
                hostedFactory === defaultHostedFactory
              )
                verifyHostedAssets();
              const room = manager.getById(ch.room);
              const vip = [u.vip_level, Users.getById(ch.from).vip_level].sort(
                  (a, b) =>
                    ["BRONZE", "OURO", "DIAMANTE", "CRISTAL"].indexOf(b) -
                    ["BRONZE", "OURO", "DIAMANTE", "CRISTAL"].indexOf(a),
                )[0],
                rake = ch.stake
                  ? rakeCentsForPot(ch.stake, {
                      vipLevel: vip,
                      roomRakePercent: room?.rakePercent,
                    })
                  : 0;
              const needsHosted = ch.mode === "APOSTADO";
              const enqueue = needsHosted && hostedBusy();
              const m = {
                id: "match_" + uuid(),
                a: ch.from,
                b: u.id,
                room: ch.room,
                mode: ch.mode,
                stake: ch.stake,
                prize: ch.stake * 2 - rake,
                rake,
                phase: enqueue ? "QUEUED" : "LOADING",
                queuePosition: null,
                rules: makeRules({
                  durationMs: Number(process.env.MATCH_DURATION_MS) || 1200000,
                  reviewMs: Number(process.env.MATCH_REVIEW_MS) || 86400000,
                  hosted: needsHosted,
                }),
                ready: new Set(),
                mediaConnected: new Set(),
                reports: new Map(),
                grace: new Map(),
              };
              db.transaction(() => {
                finance.createMatch({
                  id: m.id,
                  roomId: m.room,
                  playerAId: m.a,
                  playerBId: m.b,
                  mode: m.mode,
                  stakeCents: m.stake,
                  prizeCents: m.prize,
                  rakeCents: rake,
                  phase: m.phase,
                });
                saveRules(m.id, m.rules);
              })();
              for (const client of [c, from[1]])
                client.input = { epoch: uuid(), seq: 0, pressed: new Set() };
              clearTimeout(ch.timer);
              challenges.delete(ch.id);
              matches.set(m.id, m);
              c.matchId = m.id;
              from[1].matchId = m.id;
              if (enqueue) {
                hostedWaitQueue.push(m.id);
                m.queuePosition = hostedWaitQueue.length;
                for (const id of [m.a, m.b]) {
                  send(connection(id)[0], {
                    type: "MATCH_STARTED",
                    ...payload(m, id),
                  });
                  send(connection(id)[0], {
                    type: "HOSTED_QUEUED",
                    matchId: m.id,
                    position: m.queuePosition,
                    message: `Servidor ocupado. Você está na posição ${m.queuePosition} da fila; as reservas estão preservadas.`,
                  });
                  walletUpdate(id);
                }
                refresh(m.room);
                return;
              }
              m.deadline = setTimeout(
                () =>
                  cancel(
                    m,
                    "Tempo de preparação esgotado. Reservas devolvidas.",
                  ),
                Number(process.env.MATCH_LOADING_MS) || 180000,
              );
              for (const id of [m.a, m.b]) {
                send(connection(id)[0], {
                  type: "MATCH_STARTED",
                  ...payload(m, id),
                });
                walletUpdate(id);
              }
              refresh(m.room);
              if (m.rules.transport === "server-stream") launchHosted(m);
              return;
            }
            if (
              [
                "MATCH_SIGNAL",
                "GAME_READY",
                "GAME_FAILED",
                "CANCEL_MATCH",
                "DISPUTE_MATCH",
                "REPORT_MATCH_RESULT",
                "PLAYER_INPUT",
                "NETPLAY_FRAME",
              ].includes(d.type)
            ) {
              const { m, other } = member(c, d);
              if (d.type === "MATCH_SIGNAL") {
                if (!d.signal || JSON.stringify(d.signal).length > 64000)
                  throw fail("Sinal inválido.");
                if (m.worker) {
                  if (!m.workerReady)
                    throw fail("Aguarde a execução oficial iniciar.");
                  if (
                    !["viewer-ready", "answer", "ice"].includes(d.signal.kind)
                  )
                    throw fail("Sinal não permitido na sessão oficial.");
                  await m.worker.signal(u.id === m.a ? 1 : 2, d.signal);
                  return;
                }
                send(connection(other)?.[0], {
                  type: "MATCH_SIGNAL",
                  matchId: m.id,
                  signal: d.signal,
                  fromSlot: u.id === m.a ? 1 : 2,
                });
                return;
              }
              if (
                ["GAME_FAILED", "CANCEL_MATCH", "DISPUTE_MATCH"].includes(
                  d.type,
                )
              ) {
                appendEvent(m.id, u.id, "STOP_REQUESTED", {
                  command: d.type,
                  phase: m.phase,
                });
                if (m.phase !== "LOADING") {
                  review(
                    m,
                    u.id,
                    d.type === "DISPUTE_MATCH"
                      ? "Resultado contestado pelo participante."
                      : "Interrupção após início solicitada pelo participante.",
                  );
                  return;
                }
                cancel(
                  m,
                  d.type === "DISPUTE_MATCH"
                    ? "Resultado contestado. Reservas devolvidas."
                    : "Preparação ou conexão interrompida. Reservas devolvidas.",
                  d.type === "DISPUTE_MATCH",
                );
                return;
              }
              if (d.type === "GAME_READY") {
                if (m.phase === "LOADING") {
                  m.ready.add(u.id);
                  appendEvent(m.id, u.id, "CLIENT_READY", {
                    trustedGameProof: false,
                  });
                  startIfReady(m);
                }
                return;
              }
              if (d.type === "PLAYER_INPUT") {
                if (m.phase !== "RUNNING")
                  throw fail("Aguarde os dois jogadores ficarem prontos.");
                if (
                  d.slot !== undefined ||
                  d.port !== undefined ||
                  d.userId !== undefined
                )
                  throw fail("A porta de controle é definida pela sessão.");
                const input = acceptInput(c.input, d);
                if (!m.rules.allowedButtons.includes(d.button)) {
                  c.input.pressed.delete(d.button);
                  throw fail("Comando reservado à execução oficial.");
                }
                appendEvent(m.id, u.id, "INPUT_ACCEPTED", {
                  ...input,
                  epoch: c.input.epoch,
                  slot: u.id === m.a ? 1 : 2,
                });
                if (m.worker) {
                  await m.worker.input(u.id === m.a ? 1 : 2, d.button, d.value);
                  send(ws, {
                    type: "INPUT_ACK",
                    matchId: m.id,
                    seq: input.seq,
                    slot: u.id === m.a ? 1 : 2,
                    acceptedAt: Date.now(),
                  });
                  return;
                }
                send(connection(m.a)?.[0], {
                  type: "REMOTE_PLAYER_INPUT",
                  matchId: m.id,
                  slot: u.id === m.a ? 1 : 2,
                  seq: input.seq,
                  epoch: c.input.epoch,
                  button: d.button,
                  value: d.value,
                });
                return;
              }
              if (d.type === "NETPLAY_FRAME")
                throw fail(
                  "Sessão compartilhada: frames de outra engine foram rejeitados.",
                );
              if (m.worker)
                throw fail(
                  "Resultado de desafio com créditos é coletado exclusivamente pela execução oficial.",
                  403,
                );
              if (!["RUNNING", "AWAITING_RESULT"].includes(m.phase))
                throw fail("A partida ainda não começou.");
              if (![m.a, m.b].includes(d.winnerId))
                throw fail("Vencedor não pertence à partida.");
              if (m.reports.has(u.id) && m.reports.get(u.id) !== d.winnerId)
                throw fail("Resultado já informado; abra uma disputa.");
              if (m.reports.has(u.id)) return;
              m.reports.set(u.id, d.winnerId);
              appendEvent(m.id, u.id, "DEMO_RESULT_REPORTED", {
                winnerId: d.winnerId,
                trustedGameProof: false,
              });
              if (m.reports.size === 2) {
                const a = m.reports.get(m.a),
                  b = m.reports.get(m.b);
                if (a !== b)
                  cancel(
                    m,
                    "Resultados divergentes. Reservas devolvidas.",
                    true,
                  );
                else settle(m, a);
              } else {
                phase(m, "AWAITING_RESULT");
                both(m, {
                  type: "RESULT_PENDING",
                  matchId: m.id,
                  winnerId: d.winnerId,
                  reporterId: u.id,
                  message: "Confira a tela e confirme o resultado informado.",
                });
                if (!m.reportTimer)
                  m.reportTimer = setTimeout(
                    () =>
                      cancel(
                        m,
                        "Resultado sem confirmação. Reservas devolvidas.",
                        true,
                      ),
                    Number(process.env.RESULT_CONFIRM_MS) || 60000,
                  );
              }
              return;
            }
            throw fail("Ação indisponível: " + d.type);
          } catch (e) {
            send(ws, {
              type: [401, 403].includes(e.status)
                ? "AUTH_ERROR"
                : "ERROR_NOTICE",
              code: e.status || 400,
              message: e.message,
            });
          } finally {
            pending--;
          }
        })
        .catch(() => {});
    });
    ws.on("close", () => {
      clients.delete(ws);
      wsCleanup(ws);
      if (c.superseded) return;
      for (const ch of [...challenges.values()])
        if ([ch.from, ch.to].includes(c.userId))
          challengeEnd(ch, "Jogador desconectou.");
      const m = matches.get(c.matchId);
      if (m && !m.grace.has(c.userId)) {
        if (m.worker) {
          for (let button = 0; button < 10; button++) {
            m.worker.input(c.userId === m.a ? 1 : 2, button, 0).catch(() => {});
          }
          m.worker.pause().catch(() => {});
        }
        appendEvent(m.id, c.userId, "DISCONNECTED", { phase: m.phase });
        m.grace.set(
          c.userId,
          setTimeout(() => cancel(m, "Prazo de reconexão esgotado."), graceMs),
        );
        both(m, {
          type: "PEER_DISCONNECTED",
          matchId: m.id,
          userId: c.userId,
          reconnectMs: graceMs,
        });
      }
      refresh(c.roomId);
    });
  });
  const heartbeat = setInterval(() => {
    for (const [ws, c] of clients) {
      if (!c.alive) {
        ws.terminate();
        continue;
      }
      c.alive = false;
      ws.ping();
      if (c.token && !Sessions.validate(c.token))
        ws.close(4001, "Sessão expirada");
    }
    cleanupExpiredSessions();
  }, 15000);
  heartbeat.unref();
  const reviewSweep = setInterval(() => {
    try {
      for (const result of expireReviews()) publishReviewDecision(result);
    } catch (error) {
      console.error("[REVIEW]", error.message);
    }
  }, 1000);
  reviewSweep.unref();
  for (const result of expireReviews()) publishReviewDecision(result);
  (async () => {
    const email = process.env.ADMIN_EMAIL || "admin@arena.gg";
    if (!Users.get(email) && process.env.ADMIN_PASSWORD)
      Users.create({
        id: "usr_" + uuid(),
        username: "ArenaAdmin",
        email,
        password: await hashPassword(process.env.ADMIN_PASSWORD),
        role: "ADMIN",
      });
    else if (!Users.get(email))
      console.log("[SETUP] Defina ADMIN_PASSWORD para criar o administrador.");
    server.listen(port, host, () =>
      console.log(
        `[Arena 13.0] http://${host}:${server.address().port} | fundos simulados: ${simulation ? "SIM" : "NÃO"}`,
      ),
    );
  })().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
  let closing = false;
  return {
    server,
    wss,
    matches,
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(heartbeat);
      clearInterval(reviewSweep);
      for (const ch of challenges.values()) clearTimeout(ch.timer);
      hostedWaitQueue.length = 0;
      for (const m of [...matches.values()])
        cancel(m, "Servidor reiniciando. Reservas devolvidas.");
      for (const ws of wss.clients) ws.terminate();
      await new Promise((r) => server.close(r));
      try {
        db.close();
      } catch {}
    },
  };
}
