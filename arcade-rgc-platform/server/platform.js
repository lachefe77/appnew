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
  InviteCodes,
  UserLimits,
  UserStats,
  ControlProfiles,
  UserPrefs,
  AdminMfaStore,
  MatchHistory,
} from "./db.js";
import { finance, cents, recoverMatches } from "./finance.js";
import { HostedSession } from "./hosted-session.js";
import { verifyHostedAssets } from "./hosted-assets.js";
import { mintIceServers } from "./turn-credentials.js";
import {
  makeRules,
  saveRules,
  appendEvent,
  transition,
  acceptInput,
  openReview,
  resolveReview,
  expireReviews,
  SERIES_BEST_OF,
  seriesWinsNeeded,
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
import { can, roleAtLeast, assignableRoles, normalizeRole } from "./roles.js";
import { audit } from "./audit-middleware.js";
import {
  ensureDefaultTheme,
  getActiveTheme,
  setActiveTheme,
} from "./theme-settings.js";
import {
  createReadyCheck,
  ackReady,
  tickCountdown,
  resetReadyCheck,
} from "./ready-check.js";
import { createPaymentProvider } from "./payment-provider.js";
import { assertAdminMfa, generateTotpSecret } from "./admin-mfa.js";
import { WarmPool } from "./warm-pool.js";
import {
  createFreerollRegistration,
  registerFreerollPlayer,
  reportFreerollWinner,
  FREEROLL_SIZE,
} from "./freeroll.js";
import {
  computeCommandToImageMs,
  latencyRollingStats,
} from "./command-latency.js";

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
const dailyLossLimitCents =
  Number(process.env.DAILY_LOSS_LIMIT_CENTS) || 5000;
const MATCH_MODES = Object.freeze(["AMISTOSO", "RANKED", "APOSTADO"]);
const scoreboardMs = Number(process.env.SCOREBOARD_INTERVAL_MS) || 2000;
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
const disputeLockedCents = (id) => {
  if (!id) return 0;
  const row = db
    .prepare(
      `
      SELECT COALESCE(SUM(stake_cents),0) AS c
      FROM matches
      WHERE status='DISPUTE' AND (player_a_id=? OR player_b_id=?)
    `,
    )
    .get(id, id);
  return Number(row?.c) || 0;
};
const walletView = (id) => {
  const w = id ? Wallets.get(id) : null;
  const availableCents = w?.balance || 0;
  const lockedCents = w?.locked || 0;
  const disputeCents = Math.min(lockedCents, disputeLockedCents(id));
  const reservedCents = Math.max(0, lockedCents - disputeCents);
  return {
    balanceCents: availableCents,
    locked: lockedCents,
    availableCents,
    reservedCents,
    disputeCents,
    balanceReais: (availableCents / 100).toFixed(2),
    lockedReais: (lockedCents / 100).toFixed(2),
    availableReais: (availableCents / 100).toFixed(2),
    reservedReais: (reservedCents / 100).toFixed(2),
    disputeReais: (disputeCents / 100).toFixed(2),
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
  ensureDefaultTheme();
  const payments = createPaymentProvider({ simulation });
  const freerolls = new Map();
  const warmPool = new WarmPool({
    size: Number(process.env.HOSTED_WARM_POOL) || 0,
    factory: async (meta) => {
      // Pool só pré-aloca handles leves; a sessão real nasce no launchHosted.
      return {
        meta,
        async warmReady() {},
        async bind() {},
        async reset() {},
        async stop() {},
      };
    },
  });
  warmPool.start().catch((e) => console.error("[WARM_POOL]", e.message));
  const clients = new Map(),
    matches = new Map(),
    challenges = new Map(),
    foundMatches = new Map(), // MATCH_FOUND pendentes (fila Find Match)
    rematchOffers = new Map(), // ofertas de revanche pós-série
    spectators = new Map(), // matchId -> Set(userId)
    hostedWaitQueue = []; // match ids aguardando slot server-stream
  const tournaments = new TournamentEngine();
  const parseSeriesBestOf = (value, fallback = 1) => {
    const n = value === undefined || value === null ? fallback : Number(value);
    if (!SERIES_BEST_OF.includes(n))
      throw fail("Formato de série inválido (Bo1, Bo3 ou Bo5).");
    return n;
  };
  const assertDailyLossOk = (userId, stakeCents) => {
    if (!stakeCents) return;
    const lim = UserLimits.get(userId);
    if ((lim.daily_loss_cents || 0) + stakeCents > dailyLossLimitCents)
      throw fail(
        `Limite diário de perda atingido (${(dailyLossLimitCents / 100).toFixed(2)} créditos).`,
        429,
      );
  };
  const isBusyUser = (userId) =>
    [...matches.values()].some((m) => [m.a, m.b].includes(userId)) ||
    [...challenges.values()].some((ch) => [ch.from, ch.to].includes(userId)) ||
    [...foundMatches.values()].some((f) => [f.a, f.b].includes(userId));
  const hostedCap = () => Math.max(1, Number(process.env.HOSTED_MAX_SESSIONS) || 1);
  const hostedActiveCount = () =>
    [...matches.values()].filter(
      (m) =>
        m.rules?.transport === "server-stream" &&
        m.phase !== "QUEUED" &&
        (m.worker || m.workerReady || m.phase === "LOADING" || m.phase === "RUNNING"),
    ).length;
  const hostedBusy = () => hostedActiveCount() >= hostedCap();
  const hostedAvgMatchSec = () =>
    Math.max(30, Number(process.env.HOSTED_AVG_MATCH_SEC) || 180);
  const queueEtaPayload = (position) => {
    const placeInQueue = Math.max(1, Number(position) || 1);
    const etaSeconds = placeInQueue * hostedAvgMatchSec();
    return { placeInQueue, position: placeInQueue, etaSeconds };
  };
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
    if (u.is_frozen || (admin && !roleAtLeast(u.role, "ADMIN")))
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
  const payload = (m, id) => {
    const queue =
      m.phase === "QUEUED" && m.queuePosition
        ? queueEtaPayload(m.queuePosition)
        : { placeInQueue: null, position: null, etaSeconds: null };
    return {
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
      queuePosition: queue.position,
      placeInQueue: queue.placeInQueue,
      etaSeconds: queue.etaSeconds,
      seriesBestOf: m.seriesBestOf || m.rules.seriesBestOf || 1,
      seriesScore: m.seriesScore || { a: 0, b: 0 },
      rules: m.rules,
      inputEpoch: connection(id)?.[1].input.epoch,
      nextInputSeq: (connection(id)?.[1].input.seq || 0) + 1,
    };
  };
  const both = (m, d) => {
    for (const id of [m.a, m.b]) send(connection(id)?.[0], d);
  };
  const phase = (m, p) => {
    transition(m, p);
    m.phase = p;
  };
  function broadcastScoreboard(m) {
    if (!m || !matches.has(m.id)) return;
    both(m, {
      type: "SCOREBOARD_UPDATE",
      matchId: m.id,
      seriesScore: m.seriesScore || { a: 0, b: 0 },
      seriesBestOf: m.seriesBestOf || 1,
      games: m.games || [],
      phase: m.phase,
      metrics: m.lastMetrics || null,
    });
  }
  function armScoreboard(m) {
    clearInterval(m.scoreboardTimer);
    m.scoreboardTimer = setInterval(() => broadcastScoreboard(m), scoreboardMs);
    if (typeof m.scoreboardTimer.unref === "function") m.scoreboardTimer.unref();
    broadcastScoreboard(m);
  }
  function clearMatch(m) {
    m.worker?.stop().catch((error) => console.error("[HOSTED]", error.message));
    for (const t of m.grace.values()) clearTimeout(t);
    clearTimeout(m.deadline);
    clearTimeout(m.reportTimer);
    clearInterval(m.scoreboardTimer);
    clearInterval(m.readyCheckTimer);
    spectators.delete(m.id);
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
    audit({ id: "SYSTEM", role: "SYSTEM" }, dispute ? "MATCH_DISPUTE" : "MATCH_CANCEL", {
      targetType: "match",
      targetId: m.id,
      matchId: m.id,
      roomId: m.room,
      reason,
    });
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
        seriesScore: m.seriesScore,
        seriesBestOf: m.seriesBestOf,
      },
    );
    try {
      const ranked = m.mode === "RANKED",
        credit = m.mode === "APOSTADO";
      UserStats.recordMatch(winner, { ranked, credit, win: true });
      UserStats.recordMatch(winner === m.a ? m.b : m.a, {
        ranked,
        credit,
        win: false,
      });
    } catch {}
    try {
      replayEngine.finishRecording(m.id, winner);
    } catch {}
    both(m, {
      type: "MATCH_ENDED",
      matchId: m.id,
      winnerId: winner,
      winnerUsername: Users.getById(winner).username,
      prizeReais: (m.prize / 100).toFixed(2),
      rakeReais: (m.rake / 100).toFixed(2),
      seriesScore: m.seriesScore || { a: 0, b: 0 },
      seriesBestOf: m.seriesBestOf || 1,
      rematchEligible: true,
    });
    for (const id of [m.a, m.b]) {
      const peer = id === m.a ? m.b : m.a;
      send(connection(id)?.[0], {
        type: "REMATCH_AVAILABLE",
        matchId: m.id,
        opponentId: peer,
        opponentUsername: Users.getById(peer).username,
        mode: m.mode,
        stakeCents: m.stake,
        seriesBestOf: m.seriesBestOf || 1,
      });
    }
    for (const id of [m.a, m.b]) walletUpdate(id, "Partida encerrada.");
    audit({ id: "SYSTEM", role: "SYSTEM" }, "MATCH_SETTLE", {
      targetType: "match",
      targetId: m.id,
      matchId: m.id,
      roomId: m.room,
      winner,
    });
    // Guarda contexto curto para REMATCH_OFFER após clearMatch.
    rematchOffers.set(m.id, {
      matchId: m.id,
      a: m.a,
      b: m.b,
      room: m.room,
      mode: m.mode,
      stake: m.stake,
      seriesBestOf: m.seriesBestOf || 1,
      expires: Date.now() + 120000,
    });
    setTimeout(() => rematchOffers.delete(m.id), 120000).unref?.();
    clearMatch(m);
  }
  /** Resultado de um game da série (observador / fixture SERIES_GAME_RESULT). */
  function applyGameResult(m, winnerId, proof = {}) {
    if (
      !m ||
      !matches.has(m.id) ||
      m.reviewLock ||
      !["RUNNING", "AWAITING_RESULT"].includes(m.phase) ||
      ![m.a, m.b].includes(winnerId)
    )
      return;
    const key = winnerId === m.a ? "a" : "b";
    m.seriesScore = m.seriesScore || { a: 0, b: 0 };
    m.seriesScore[key] += 1;
    m.games = m.games || [];
    m.games.push({
      n: m.games.length + 1,
      winnerId,
      at: Date.now(),
      proof: proof?.source || proof?.event || "game-result",
    });
    appendEvent(m.id, "SERVER_WORKER", "SERIES_GAME_RESULT", {
      winnerId,
      seriesScore: m.seriesScore,
      proof,
    });
    both(m, {
      type: "SERIES_GAME_ENDED",
      matchId: m.id,
      winnerId,
      seriesScore: m.seriesScore,
      seriesBestOf: m.seriesBestOf,
      games: m.games,
    });
    broadcastScoreboard(m);
    const need = seriesWinsNeeded(m.seriesBestOf || 1);
    if (m.seriesScore.a >= need || m.seriesScore.b >= need) {
      settle(m, m.seriesScore.a >= need ? m.a : m.b);
      return;
    }
    // Série continua: reservas preservadas; limpa reports/ready do game.
    m.reports = new Map();
    m.ready = new Set();
    resetReadyCheck(m.readyCheck);
    clearTimeout(m.reportTimer);
    m.reportTimer = null;
    clearInterval(m.readyCheckTimer);
    m.readyCheckTimer = null;
    if (m.phase === "AWAITING_RESULT") {
      try {
        phase(m, "RUNNING");
      } catch {}
    }
    // Série continua: rearm o observador do worker para o próximo game.
    try {
      m.worker?.resetObserver?.();
    } catch {}
    both(m, {
      type: "SERIES_NEXT_GAME",
      matchId: m.id,
      seriesScore: m.seriesScore,
      seriesBestOf: m.seriesBestOf,
      message: "Próximo game da série. Reservas mantidas até o fechamento.",
    });
    broadcastScoreboard(m);
  }
  function onGraceExpired(m, userId) {
    if (!matches.has(m.id) || !m.grace.has(userId)) return;
    m.grace.delete(userId);
    const peerOnline = (id) => Boolean(connection(id));
    const aGone = !peerOnline(m.a);
    const bGone = !peerOnline(m.b);
    if (m.phase === "QUEUED" || m.phase === "LOADING") {
      cancel(m, "Prazo de reconexão esgotado.");
      return;
    }
    // Anti-rage-quit: um desconectado após RUNNING → vitória do oponente
    // quando rules.rageQuit='loss' e o peer permanece online.
    if (
      m.phase === "RUNNING" &&
      m.rules?.rageQuit === "loss" &&
      ((aGone && !bGone) || (bGone && !aGone))
    ) {
      const loser = aGone ? m.a : m.b;
      const winner = aGone ? m.b : m.a;
      appendEvent(m.id, loser, "RAGE_QUIT_FORFEIT", {
        winner,
        rageQuit: m.rules.rageQuit,
      });
      settle(m, winner);
      return;
    }
    // Ambos off ou política review / evidência ambígua.
    review(
      m,
      "SYSTEM",
      aGone && bGone
        ? "Ambos desconectaram após o início; evidência insuficiente para forfeit."
        : "Prazo de reconexão esgotado.",
    );
  }
  function review(m, actor, reason) {
    if (!matches.has(m.id) || m.phase === "REVIEW" || m.reviewLock) return;
    // Trava imediata em memória para bloquear onResult/settle concorrentes
    // antes da transação SQLite concluir.
    m.reviewLock = true;
    const worker = m.worker;
    const matchId = m.id;
    const finish = (evidence) => {
      if (m._reviewOpened) return;
      m._reviewOpened = true;
      const { deadlineAt } = openReview(m, actor, reason, evidence);
      m.phase = "REVIEW";
      both(m, {
        type: "MATCH_REVIEW_OPENED",
        matchId: m.id,
        reason,
        deadlineAt,
        evidence: evidence
          ? {
              kind: evidence.kind,
              relativePath: evidence.relativePath,
              at: evidence.at,
            }
          : null,
        message:
          "Partida em análise. Reservas preservadas até decisão ou prazo de revisão.",
      });
      for (const id of [m.a, m.b])
        walletUpdate(
          id,
          "Partida em análise; consulte o histórico de revisões.",
        );
      clearMatch(m);
    };
    if (worker?.captureEvidence) {
      Promise.race([
        worker.captureEvidence(matchId),
        new Promise((resolve) => setTimeout(() => resolve(null), 2500)),
      ])
        .then((evidence) => finish(evidence))
        .catch(() => finish(null));
    } else finish(null);
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
      const eta = queueEtaPayload(i + 1);
      both(queued, {
        type: "HOSTED_QUEUED",
        matchId: queued.id,
        ...eta,
        message: `Aguardando sessão oficial. Posição ${eta.placeInQueue} na fila (~${eta.etaSeconds}s).`,
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
  function validateModeStake(mode, stakeCents, room) {
    if (!MATCH_MODES.includes(mode)) throw fail("Modo inválido.");
    if (mode === "APOSTADO" && !simulation)
      throw fail(
        "Partidas com saldo disponíveis somente no ambiente de teste.",
        409,
      );
    if (mode === "APOSTADO") {
      if (room?.game !== "KOF 2002")
        throw fail(
          "Este jogo ainda não possui perfil de execução oficial validado.",
          409,
        );
      if (hostedFactory === defaultHostedFactory) verifyHostedAssets();
      return cents(stakeCents, { max: 100000 });
    }
    return 0;
  }
  function issueChallenge({
    fromId,
    toId,
    roomId,
    mode,
    stake,
    seriesBestOf = 1,
    inviteCode = null,
  }) {
    const ch = {
      id: "chal_" + uuid(),
      from: fromId,
      to: toId,
      room: roomId,
      mode,
      stake,
      seriesBestOf,
      inviteCode,
      expires: Date.now() + 30000,
    };
    ch.timer = setTimeout(
      () => challengeEnd(ch, "Desafio expirado."),
      30000,
    );
    challenges.set(ch.id, ch);
    const fromUser = Users.getById(fromId);
    send(connection(toId)?.[0], {
      type: "CHALLENGE_RECEIVED",
      challengeId: ch.id,
      from: { id: fromId, username: fromUser.username, elo: fromUser.elo },
      mode: ch.mode,
      stakeCents: stake,
      stakeReais: (stake / 100).toFixed(2),
      seriesBestOf: ch.seriesBestOf,
      inviteCode: ch.inviteCode || null,
    });
    send(connection(fromId)?.[0], {
      type: "CHALLENGE_SENT",
      challengeId: ch.id,
      targetUsername: Users.getById(toId).username,
      seriesBestOf: ch.seriesBestOf,
      inviteCode: ch.inviteCode || null,
    });
    refresh(roomId);
    return ch;
  }
  function startMatchBetween({
    playerAId,
    playerBId,
    roomId,
    mode,
    stake,
    seriesBestOf = 1,
  }) {
    const room = manager.getById(roomId);
    const ua = Users.getById(playerAId),
      ub = Users.getById(playerBId);
    const vip = [ua.vip_level, ub.vip_level].sort(
        (a, b) =>
          ["BRONZE", "OURO", "DIAMANTE", "CRISTAL"].indexOf(b) -
          ["BRONZE", "OURO", "DIAMANTE", "CRISTAL"].indexOf(a),
      )[0],
      rake = stake
        ? rakeCentsForPot(stake, {
            vipLevel: vip,
            roomRakePercent: room?.rakePercent,
          })
        : 0;
    const needsHosted = mode === "APOSTADO";
    const enqueue = needsHosted && hostedBusy();
    const bestOf = parseSeriesBestOf(seriesBestOf, 1);
    const m = {
      id: "match_" + uuid(),
      a: playerAId,
      b: playerBId,
      room: roomId,
      mode,
      stake,
      prize: stake * 2 - rake,
      rake,
      phase: enqueue ? "QUEUED" : "LOADING",
      queuePosition: null,
      seriesBestOf: bestOf,
      seriesScore: { a: 0, b: 0 },
      games: [],
      lastMetrics: null,
      rules: makeRules({
        durationMs: Number(process.env.MATCH_DURATION_MS) || 1200000,
        reviewMs: Number(process.env.MATCH_REVIEW_MS) || 86400000,
        hosted: needsHosted,
        seriesBestOf: bestOf,
        rageQuit: "loss",
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
    const ca = connection(playerAId)?.[1],
      cb = connection(playerBId)?.[1];
    for (const client of [ca, cb]) {
      if (!client) continue;
      client.input = { epoch: uuid(), seq: 0, pressed: new Set() };
      client.matchId = m.id;
    }
    matches.set(m.id, m);
    if (enqueue) {
      hostedWaitQueue.push(m.id);
      m.queuePosition = hostedWaitQueue.length;
      const eta = queueEtaPayload(m.queuePosition);
      for (const id of [m.a, m.b]) {
        send(connection(id)[0], {
          type: "MATCH_STARTED",
          ...payload(m, id),
        });
        send(connection(id)[0], {
          type: "HOSTED_QUEUED",
          matchId: m.id,
          ...eta,
          message: `Servidor ocupado. Posição ${eta.placeInQueue} na fila (~${eta.etaSeconds}s); reservas preservadas.`,
        });
        walletUpdate(id);
      }
      refresh(m.room);
      return m;
    }
    m.deadline = setTimeout(
      () =>
        cancel(m, "Tempo de preparação esgotado. Reservas devolvidas."),
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
    return m;
  }
  function notifyRoomMatchOpen(roomId, found) {
    broadcast(
      {
        type: "MATCH_OPEN",
        foundMatchId: found.id,
        mode: found.mode,
        stakeCents: found.stake,
        seriesBestOf: found.seriesBestOf,
        players: [
          { id: found.a, username: Users.getById(found.a).username },
          { id: found.b, username: Users.getById(found.b).username },
        ],
      },
      roomId,
    );
  }
  function createFoundMatch(rowA, rowB) {
    const id = "found_" + uuid();
    const roomId = rowA.room_id || rowB.room_id || "";
    const found = {
      id,
      a: rowA.user_id,
      b: rowB.user_id,
      mode: rowA.mode,
      stake: rowA.stake_cents,
      seriesBestOf: rowA.series_best_of || 1,
      room: roomId,
      accepts: new Set(),
      expires: Date.now() + 30000,
    };
    found.timer = setTimeout(() => {
      foundMatches.delete(id);
      for (const uid of [found.a, found.b]) {
        MatchmakingQueue.leave(uid);
        send(connection(uid)?.[0], {
          type: "MATCH_FOUND_EXPIRED",
          foundMatchId: id,
          message: "Proposta de fila expirou.",
        });
      }
      refresh(found.room);
    }, 30000);
    foundMatches.set(id, found);
    MatchmakingQueue.leave(found.a);
    MatchmakingQueue.leave(found.b);
    for (const uid of [found.a, found.b]) {
      const peer = uid === found.a ? found.b : found.a;
      send(connection(uid)?.[0], {
        type: "MATCH_FOUND",
        foundMatchId: id,
        mode: found.mode,
        stakeCents: found.stake,
        seriesBestOf: found.seriesBestOf,
        opponent: {
          id: peer,
          username: Users.getById(peer).username,
          elo: Users.getById(peer).elo,
        },
        expiresAt: found.expires,
      });
    }
    if (found.room) notifyRoomMatchOpen(found.room, found);
    return found;
  }
  function tryFindMatch(userId) {
    MatchmakingQueue.cleanup();
    const self = MatchmakingQueue.get(userId);
    if (!self) return null;
    const opp = MatchmakingQueue.findMatch(
      userId,
      self.elo,
      self.mode,
      self.stake_cents,
      self.room_id,
      self.series_best_of || 1,
      { region: self.region || "", maxRttMs: Number(process.env.MATCH_MAX_RTT_MS) || 250 },
    );
    if (!opp) return null;
    if (isBusyUser(opp.user_id) || connection(opp.user_id)?.[1]?.matchId) {
      MatchmakingQueue.leave(opp.user_id);
      return null;
    }
    return createFoundMatch(self, opp);
  }

  function beginReadyCheck(m) {
    if (m.readyCheck?.phase === "COUNTDOWN" || m.readyCheck?.phase === "DONE")
      return;
    m.readyCheck = createReadyCheck({ matchId: m.id });
    both(m, {
      type: "READY_CHECK_START",
      matchId: m.id,
      need: 2,
      message: "Confirme prontidão (P1 e P2) para o countdown.",
    });
  }

  function finishReadyCheckToRunning(m) {
    if (!matches.has(m.id) || m.phase !== "LOADING") return;
    phase(m, "RUNNING");
    clearTimeout(m.deadline);
    clearInterval(m.readyCheckTimer);
    m.readyCheckTimer = null;
    m.deadline = setTimeout(
      () => cancel(m, "Tempo máximo de partida esgotado."),
      m.rules.durationMs,
    );
    m.worker?.resume().catch((error) => cancel(m, error.message));
    try {
      replayEngine.startRecording(m.id, m.a, m.b, m.stake);
    } catch {}
    both(m, { type: "GAME_RUNNING", matchId: m.id, readyCheck: true });
    armScoreboard(m);
  }

  function armReadyCountdown(m) {
    clearInterval(m.readyCheckTimer);
    m.readyCheckTimer = setInterval(() => {
      const tick = tickCountdown(m.readyCheck);
      if (!tick || !matches.has(m.id)) {
        clearInterval(m.readyCheckTimer);
        return;
      }
      both(m, tick);
      if (tick.type === "READY_CHECK_DONE") {
        clearInterval(m.readyCheckTimer);
        m.readyCheckTimer = null;
        finishReadyCheckToRunning(m);
      }
    }, 1000);
    m.readyCheckTimer.unref?.();
  }

  function handleReadyAck(m, userId) {
    if (!m || m.phase !== "LOADING") return;
    if (!m.readyCheck) beginReadyCheck(m);
    const ev = ackReady(m.readyCheck, userId);
    if (!ev) return;
    both(m, ev);
    if (ev.type === "READY_CHECK_DONE") {
      finishReadyCheckToRunning(m);
      return;
    }
    if (ev.type === "READY_CHECK_COUNTDOWN") armReadyCountdown(m);
  }

  function startIfReady(m) {
    if (
      m.phase !== "LOADING" ||
      m.ready.size !== 2 ||
      (m.worker && (!m.workerReady || m.mediaConnected.size !== 2))
    )
      return;
    // GAME_READY dos dois conta como ACK do ready-check (overlay pode reenviar READY_ACK).
    if (!m.readyCheck) beginReadyCheck(m);
    if (m.readyCheck.phase === "DONE") {
      finishReadyCheckToRunning(m);
      return;
    }
    if (m.readyCheck.phase === "WAITING_ACKS") {
      for (const uid of m.ready) handleReadyAck(m, uid);
    }
  }

  async function launchHosted(m) {
    try {
      const iceBundle = mintIceServers();
      m.iceBundle = iceBundle;
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
        onSample: () => {},
        onObservation: (observation) => {
          if (!matches.has(m.id)) return;
          appendEvent(
            m.id,
            "SERVER_WORKER",
            observation.event,
            observation.sample,
          );
          // Fixture/worker pode emitir SERIES_GAME_RESULT sem fechar a série.
          if (
            observation.event === "SERIES_GAME_RESULT" &&
            [1, 2].includes(observation.sample?.winnerSlot)
          ) {
            applyGameResult(
              m,
              observation.sample.winnerSlot === 1 ? m.a : m.b,
              observation.sample,
            );
          }
        },
        onResult: (proof) => {
          if (
            !matches.has(m.id) ||
            m.reviewLock ||
            !["RUNNING", "AWAITING_RESULT"].includes(m.phase) ||
            ![1, 2].includes(proof.winnerSlot)
          )
            return;
          appendEvent(m.id, "SERVER_WORKER", "SERVER_RESULT", proof);
          applyGameResult(m, proof.winnerSlot === 1 ? m.a : m.b, proof);
        },
        onMetrics: (metrics) => {
          if (!matches.has(m.id)) return;
          // Normaliza peers (rttSeconds/packetsLost) → HUD (rttMs/packetLoss/fps).
          const peers = metrics?.peers || {};
          const samples = Object.values(peers);
          const rttSec = samples
            .map((p) => p?.rttSeconds)
            .filter((v) => typeof v === "number");
          const loss = samples
            .map((p) => p?.packetsLost ?? p?.packetLoss)
            .filter((v) => typeof v === "number");
          const fps = samples
            .map((p) => p?.framesPerSecond ?? p?.fps)
            .filter((v) => typeof v === "number");
          m.lastMetrics = {
            ...metrics,
            rttMs: rttSec.length
              ? Math.round(
                  (rttSec.reduce((a, b) => a + b, 0) / rttSec.length) * 1000,
                )
              : null,
            packetLoss: loss.length
              ? Number(
                  (loss.reduce((a, b) => a + b, 0) / loss.length).toFixed(3),
                )
              : null,
            fps: fps.length
              ? Math.round(fps.reduce((a, b) => a + b, 0) / fps.length)
              : metrics?.frameRate || null,
            commandLatency: m.latencyStats || null,
          };
          both(m, {
            type: "HOSTED_METRICS",
            matchId: m.id,
            metrics: m.lastMetrics,
          });
          broadcastScoreboard(m);
        },
        iceServers: iceBundle.iceServers,
      });
      const result = await m.worker.start();
      if (!matches.has(m.id)) return m.worker.stop();
      m.workerReady = true;
      appendEvent(m.id, "SERVER_WORKER", "WORKER_READY", {
        manifest: result.manifest,
        turnEphemeral: iceBundle.ephemeral,
        turnTtlSec: iceBundle.ttlSec,
      });
      both(m, {
        type: "HOSTED_READY",
        matchId: m.id,
        iceServers: iceBundle.iceServers,
        turnEphemeral: iceBundle.ephemeral,
        turnTtlSec: iceBundle.ttlSec,
      });
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
            modes: MATCH_MODES,
            seriesBestOf: SERIES_BEST_OF,
            dailyLossLimitCents,
            rageQuitDefault: "loss",
            themeId: getActiveTheme().id,
          });
        if (p === "/api/theme") return json(res, 200, getActiveTheme());
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
              spectators: spectators.get(m.id)?.size || 0,
            })),
          });
        if (p === "/api/matches/recent")
          return json(res, 200, {
            matches: db
              .prepare(
                `SELECT m.*,
                        a.username AS p1_name,
                        b.username AS p2_name,
                        a.username AS player_a_username,
                        b.username AS player_b_username
                 FROM matches m
                 JOIN users a ON a.id=m.player_a_id
                 JOIN users b ON b.id=m.player_b_id
                 ORDER BY started_at DESC LIMIT 20`,
              )
              .all(),
          });
        if (p === "/api/me/matches" && req.method === "GET") {
          const u = httpAccount(req);
          return json(res, 200, {
            matches: MatchHistory.forUser(u.id),
          });
        }
        if (p === "/api/me/controls") {
          const u = httpAccount(req);
          if (req.method === "GET") {
            return json(res, 200, {
              controls: ControlProfiles.get(u.id)?.controls || null,
              updatedAt: ControlProfiles.get(u.id)?.updatedAt || null,
            });
          }
          if (req.method === "PUT" || req.method === "POST") {
            const d = await body(req);
            const saved = ControlProfiles.save(u.id, d.controls || d);
            return json(res, 200, { ok: true, ...saved });
          }
        }
        if (p === "/api/me/tutorial") {
          const u = httpAccount(req);
          if (req.method === "GET")
            return json(res, 200, { prefs: UserPrefs.get(u.id) });
          if (req.method === "POST") {
            const d = await body(req);
            return json(res, 200, {
              prefs: UserPrefs.setTutorial(u.id, {
                done: d.done,
                step: d.step,
              }),
            });
          }
        }
        if (p === "/api/freeroll" && req.method === "GET") {
          const list = [...freerolls.values()].map((f) => ({
            id: f.id,
            status: f.status,
            size: f.size,
            buyInCents: f.buyInCents,
            registered: f.players.length,
            championId: f.championId,
          }));
          return json(res, 200, { freerolls: list, size: FREEROLL_SIZE });
        }
        if (p === "/api/freeroll/register" && req.method === "POST") {
          const u = httpAccount(req);
          if (!simulation)
            throw fail("Freeroll só em crédito fictício (lab).", 409);
          const d = await body(req);
          let fr = freerolls.get(d.freerollId);
          if (!fr) {
            fr = createFreerollRegistration({ id: d.freerollId || "freeroll_daily" });
            freerolls.set(fr.id, fr);
          }
          registerFreerollPlayer(fr, u.id);
          return json(res, 200, {
            ok: true,
            freeroll: {
              id: fr.id,
              status: fr.status,
              registered: fr.players.length,
              size: fr.size,
              rounds: fr.rounds?.length || 0,
            },
          });
        }
        if (p === "/api/freeroll/report" && req.method === "POST") {
          const admin = httpAccount(req);
          if (!roleAtLeast(admin.role, "ADMIN")) throw fail("Acesso negado.", 403);
          const d = await body(req);
          const fr = freerolls.get(d.freerollId);
          if (!fr) throw fail("Freeroll não encontrado.", 404);
          reportFreerollWinner(
            fr,
            Number(d.roundIndex),
            Number(d.matchIndex),
            d.winnerId,
          );
          return json(res, 200, { ok: true, freeroll: fr });
        }
        if (p === "/api/admin/mfa/setup" && req.method === "POST") {
          const admin = httpAccount(req);
          if (!roleAtLeast(admin.role, "ADMIN")) throw fail("Acesso negado.", 403);
          assertAdminIpAllowed(req);
          const secret = generateTotpSecret();
          AdminMfaStore.enable(admin.id, secret);
          return json(res, 200, {
            ok: true,
            secret,
            message: "Guarde o secret TOTP. MFA_ENFORCE=1 exige código.",
          });
        }
        if (p === "/api/ops/warm-pool" && req.method === "GET") {
          return json(res, 200, { warmPool: warmPool.stats() });
        }
        if (p === "/api/ops/hosted-cap" && req.method === "GET") {
          return json(res, 200, {
            hostedMaxSessions: hostedCap(),
            hostedActiveSessions: hostedActiveCount(),
            isolation: "process-worker-per-session",
            note:
              "Cada HostedSession usa browser Playwright isolado; container/cgroup é gap de infra VPS.",
          });
        }
        const integrityRoute = /^\/api\/matches\/([^/]+)\/integrity$/.exec(p);
        if (integrityRoute && req.method === "GET") {
          const u = httpAccount(req),
            match = db
              .prepare("SELECT * FROM matches WHERE id=?")
              .get(integrityRoute[1]);
          if (
            !match ||
            (!roleAtLeast(u.role, "ADMIN") &&
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
          if (id !== u.id && !roleAtLeast(u.role, "ADMIN"))
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
          const u = httpAccount(req);
          const d = await body(req);
          const roomId = text(d.roomId || "", 80);
          const room = manager.getById(roomId);
          if (!room?.active || room.game !== "KOF 2002")
            throw fail("Informe uma sala KOF 2002 ativa.");
          if (isBusyUser(u.id))
            throw fail("Já existe desafio ou partida em andamento.");
          const seriesBestOf = parseSeriesBestOf(d.seriesBestOf, 1);
          const stake = validateModeStake(d.mode, d.stakeCents, room);
          if (stake) {
            assertDailyLossOk(u.id, stake);
            if (Wallets.get(u.id).balance < stake)
              throw fail("Saldo insuficiente para a fila.");
          }
          MatchmakingQueue.join(u.id, u.elo, d.mode, stake, roomId, seriesBestOf, {
            region: d.region || room.region || UserPrefs.get(u.id)?.region || "",
            rttMs: Number(d.rttMs) || 9999,
          });
          const found = tryFindMatch(u.id);
          return json(res, 200, {
            ok: true,
            queued: !found,
            foundMatchId: found?.id || null,
          });
        }
        if (
          p.startsWith("/api/matchmaking/leave/") &&
          req.method === "DELETE"
        ) {
          const u = httpAccount(req);
          MatchmakingQueue.leave(u.id);
          return json(res, 200, { ok: true, message: "Saiu da fila." });
        }
        if (p === "/api/invites/redeem" && req.method === "POST") {
          const u = httpAccount(req);
          const d = await body(req);
          const invite = InviteCodes.redeem(text(d.code, 16).toUpperCase());
          const room = manager.getById(invite.room_id);
          if (!room?.active) throw fail("Sala do convite indisponível.");
          return json(res, 200, {
            ok: true,
            code: invite.code,
            kind: invite.kind,
            roomId: room.id,
            room: { id: room.id, name: room.name, game: room.game },
            payload: invite.payload,
            userId: u.id,
          });
        }
        if (p.startsWith("/api/invites/") && req.method === "GET") {
          httpAccount(req);
          const code = decodeURIComponent(p.slice("/api/invites/".length));
          const invite = InviteCodes.get(code);
          if (!invite || invite.expired)
            throw fail("Código de convite inválido ou expirado.", 404);
          const room = manager.getById(invite.room_id);
          return json(res, 200, {
            code: invite.code,
            kind: invite.kind,
            roomId: invite.room_id,
            roomName: room?.name || null,
            game: room?.game || null,
            expiresAt: invite.expires_at,
            uses: invite.uses,
            maxUses: invite.max_uses,
            payload: invite.payload,
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
            assertAdminMfa({
              userId: admin.id,
              code: d.mfaCode || d.otp,
              secret: AdminMfaStore.getSecret(admin.id),
            });
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
          if (p === "/api/admin/audit-log") {
            if (!can(admin, "admin.audit")) throw fail("Acesso negado.", 403);
            const limit = Math.min(
              500,
              Math.max(1, Number(url.searchParams.get("limit")) || 100),
            );
            const action = url.searchParams.get("action") || undefined;
            const actorId = url.searchParams.get("actorId") || undefined;
            const since = url.searchParams.get("since") || undefined;
            return json(res, 200, {
              log: AuditLog.recent(limit),
              trail: AuditLog.query({ limit, action, actorId, since }),
            });
          }
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
            const d = await body(req);
            if (d.action === "START_SEASON") {
              if (!can(admin, "admin.seasons"))
                throw fail("Acesso negado.", 403);
              const { activateSeason, resetEloForSeason } = await import(
                "./seasons.js"
              );
              const season = activateSeason({
                actor: admin,
                name: text(d.name || "Season", 80),
              });
              let reset = null;
              if (d.resetElo !== false)
                reset = resetEloForSeason({
                  actor: admin,
                  seasonId: season.id,
                });
              return json(res, 200, { success: true, season, reset });
            }
            const u =
              Users.getById(d.userId) ||
              Users.get?.(d.userId) ||
              db
                .prepare("SELECT * FROM users WHERE username=? OR email=? OR id=?")
                .get(d.userId, d.userId, d.userId);
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
                assertAdminMfa({
                  userId: admin.id,
                  code: d.mfaCode || d.otp,
                  secret: AdminMfaStore.getSecret(admin.id),
                });
                const nextRole = normalizeRole(d.role);
                if (
                  !nextRole ||
                  nextRole === "GUEST" ||
                  !assignableRoles(admin.role).includes(nextRole)
                )
                  throw fail("Papel inválido.");
                Users.setRole(u.id, nextRole);
                Sessions.destroyUser(u.id);
              } else if (["APPROVE_KYC", "REJECT_KYC"].includes(d.action))
                Users.updateKyc(
                  u.email,
                  d.action === "APPROVE_KYC" ? "APROVADO" : "REJEITADO",
                  u.kyc_photo,
                );
              else throw fail("Ação não suportada.");
              AuditLog.record({
                actorId: admin.id,
                actorRole: admin.role,
                action: d.action,
                targetType: "user",
                targetId: u.id,
                meta: {
                  reason: d.reason || "",
                  amountCents: d.amountCents || 0,
                },
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
            const d = await body(req);
            assertAdminMfa({
              userId: admin.id,
              code: d.mfaCode || d.otp,
              secret: AdminMfaStore.getSecret(admin.id),
            });
            const r = db.transaction(() => {
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
          if (p === "/api/admin/theme") {
            if (!can(admin, "admin.panel")) throw fail("Acesso negado.", 403);
            if (req.method === "GET") return json(res, 200, getActiveTheme());
            if (req.method === "POST") {
              const d = await body(req);
              const theme = setActiveTheme({
                id: text(d.id || d.themeId || "neogeo-cabinet", 64),
                colors: d.colors && typeof d.colors === "object" ? d.colors : {},
              });
              AuditLog.record({
                actorId: admin.id,
                actorRole: admin.role,
                action: "SET_THEME",
                targetType: "theme",
                targetId: theme.id,
                meta: { customColors: theme.customColors },
              });
              for (const [ws] of clients)
                send(ws, { type: "THEME_UPDATED", theme });
              return json(res, 200, { success: true, theme });
            }
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
                if (roleAtLeast(u.role, "ADMIN")) assertAdminIpAllowed(req);
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
                // Reenvio HOSTED_READY para renegociar WebRTC sem matar o worker.
                if (
                  m.workerReady &&
                  m.rules?.transport === "server-stream" &&
                  ["LOADING", "RUNNING", "AWAITING_RESULT"].includes(m.phase)
                ) {
                  const ice =
                    m.iceBundle ||
                    mintIceServers();
                  m.iceBundle = ice;
                  send(ws, {
                    type: "HOSTED_READY",
                    matchId: m.id,
                    iceServers: ice.iceServers,
                    turnEphemeral: ice.ephemeral,
                    turnTtlSec: ice.ttlSec,
                    resumed: true,
                  });
                }
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
              const deposit = await payments.createDeposit({
                userId: u.id,
                amountCents: cents(d.amountCents),
                idempotencyKey: d.idempotencyKey || uuid(),
              });
              if (deposit.mock) {
                finance.credit(
                  u.id,
                  deposit.amountCents,
                  "TEST_CREDIT",
                  deposit.idempotencyKey || uuid(),
                  "Créditos de teste (PaymentProvider mock)",
                );
                walletUpdate(u.id, "Créditos de teste adicionados.");
              }
              return;
            }
            if (d.type === "SPIN_LUCKY_WHEEL")
              throw fail("Roleta indisponível.");
            if (d.type === "WITHDRAW_PIX") {
              const pixKey = text(d.pixKey || d.key || "", 120);
              await payments.createWithdraw({
                userId: u.id,
                amountCents: cents(d.amountCents),
                pixKey,
              });
              if (u.kyc_status !== "APROVADO")
                throw fail("KYC obrigatório para saque.");
              const ref = finance.requestWithdrawal(
                u.id,
                cents(d.amountCents),
                pixKey,
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
              if (!can(u, "admin.kyc")) throw fail("Acesso negado.", 403);
              assertAdminIpAllowed(req);
              if (!["APROVADO", "REJEITADO"].includes(d.decision))
                throw fail("Decisão inválida.");
              const target = Users.get(text(d.userEmail, 254));
              if (!target) throw fail("Conta não encontrada.", 404);
              db.transaction(() => {
                Users.updateKyc(target.email, d.decision, target.kyc_photo);
                AuditLog.record({
                  actorId: u.id,
                  actorRole: u.role,
                  action: "KYC_DECISION",
                  targetType: "user",
                  targetId: target.id,
                  meta: { decision: d.decision },
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
              const seriesBestOf = parseSeriesBestOf(d.seriesBestOf, 1);
              const stake = validateModeStake(d.mode, d.stakeCents, room);
              if (stake) {
                assertDailyLossOk(u.id, stake);
                assertDailyLossOk(d.targetUserId, stake);
                if (
                  Wallets.get(u.id).balance < stake ||
                  Wallets.get(d.targetUserId).balance < stake
                )
                  throw fail("Um dos jogadores não possui saldo suficiente.");
              }
              let inviteCode = null;
              if (d.includeInviteCode || d.inviteCode === true) {
                inviteCode = InviteCodes.allocate({
                  roomId: c.roomId,
                  createdBy: u.id,
                  kind: "CHALLENGE",
                  payload: {
                    mode: d.mode,
                    stakeCents: stake,
                    seriesBestOf,
                    targetUserId: d.targetUserId,
                  },
                  ttlMs: 300000,
                  maxUses: 1,
                }).code;
              } else if (typeof d.inviteCode === "string" && d.inviteCode.trim()) {
                inviteCode = text(d.inviteCode, 16).toUpperCase();
              }
              issueChallenge({
                fromId: u.id,
                toId: d.targetUserId,
                roomId: c.roomId,
                mode: d.mode,
                stake,
                seriesBestOf,
                inviteCode,
              });
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
                (d.fromUserId !== undefined && d.fromUserId !== ch.from) ||
                (d.seriesBestOf !== undefined &&
                  d.seriesBestOf !== ch.seriesBestOf)
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
              if (ch.stake) {
                assertDailyLossOk(u.id, ch.stake);
                assertDailyLossOk(ch.from, ch.stake);
              }
              if (
                ch.mode === "APOSTADO" &&
                hostedFactory === defaultHostedFactory
              )
                verifyHostedAssets();
              // Só remove o desafio após createMatch/regras — falha financeira
              // deve preservar o convite para decline/retry.
              startMatchBetween({
                playerAId: ch.from,
                playerBId: u.id,
                roomId: ch.room,
                mode: ch.mode,
                stake: ch.stake,
                seriesBestOf: ch.seriesBestOf || 1,
              });
              clearTimeout(ch.timer);
              challenges.delete(ch.id);
              return;
            }
            if (d.type === "CREATE_ROOM_INVITE") {
              if (!c.roomId) throw fail("Entre em uma sala primeiro.");
              const room = manager.getById(c.roomId);
              if (!room?.active) throw fail("Sala não encontrada.");
              const invite = InviteCodes.allocate({
                roomId: c.roomId,
                createdBy: u.id,
                kind: "ROOM",
                payload: { game: room.game, name: room.name },
                ttlMs: Number(d.ttlMs) || 3600000,
                maxUses: Number(d.maxUses) || 20,
              });
              send(ws, {
                type: "ROOM_INVITE_CREATED",
                code: invite.code,
                roomId: invite.room_id,
                expiresAt: invite.expires_at,
                maxUses: invite.max_uses,
              });
              return;
            }
            if (d.type === "JOIN_VIA_CODE" || d.type === "REDEEM_INVITE") {
              const invite = InviteCodes.redeem(text(d.code, 16).toUpperCase());
              const room = manager.getById(invite.room_id);
              if (!room?.active) throw fail("Sala do convite indisponível.");
              if (c.matchId) throw fail("Você já está em uma partida.");
              if (room.count >= room.maxPlayers && c.roomId !== room.id)
                throw fail("Sala lotada.");
              c.roomId = room.id;
              refresh(room.id);
              send(ws, {
                type: "INVITE_REDEEMED",
                code: invite.code,
                kind: invite.kind,
                roomId: room.id,
                room: {
                  id: room.id,
                  name: room.name,
                  game: room.game,
                },
                payload: invite.payload,
              });
              send(ws, { type: "ROOM_USERS", users: roster(room.id) });
              return;
            }
            if (d.type === "FIND_MATCH") {
              if (!c.roomId) throw fail("Entre em uma sala KOF 2002 primeiro.");
              const room = manager.getById(c.roomId);
              if (!room?.active || room.game !== "KOF 2002")
                throw fail("Find Match disponível apenas em salas KOF 2002.");
              if (c.matchId || isBusyUser(u.id))
                throw fail("Já existe desafio ou partida em andamento.");
              const seriesBestOf = parseSeriesBestOf(d.seriesBestOf, 1);
              const stake = validateModeStake(d.mode, d.stakeCents, room);
              if (stake) {
                assertDailyLossOk(u.id, stake);
                if (Wallets.get(u.id).balance < stake)
                  throw fail("Saldo insuficiente para a fila.");
              }
              MatchmakingQueue.leave(u.id);
              const region =
                d.region ||
                room.region ||
                UserPrefs.get(u.id)?.region ||
                "";
              const rttMs = Number(d.rttMs ?? c.ping) || 9999;
              if (d.region) UserPrefs.setRegion(u.id, d.region);
              MatchmakingQueue.join(
                u.id,
                u.elo,
                d.mode,
                stake,
                c.roomId,
                seriesBestOf,
                { region, rttMs },
              );
              send(ws, {
                type: "FIND_MATCH_QUEUED",
                mode: d.mode,
                stakeCents: stake,
                seriesBestOf,
                region,
                rttMs,
                message: "Procurando oponente compatível (região + RTT)…",
              });
              const found = tryFindMatch(u.id);
              if (!found)
                broadcast(
                  {
                    type: "MATCHMAKING_WAITING",
                    userId: u.id,
                    username: u.username,
                    mode: d.mode,
                    stakeCents: stake,
                  },
                  c.roomId,
                );
              return;
            }
            if (d.type === "CANCEL_FIND_MATCH") {
              MatchmakingQueue.leave(u.id);
              for (const [fid, found] of [...foundMatches.entries()]) {
                if (![found.a, found.b].includes(u.id)) continue;
                clearTimeout(found.timer);
                foundMatches.delete(fid);
                for (const uid of [found.a, found.b])
                  send(connection(uid)?.[0], {
                    type: "MATCH_FOUND_EXPIRED",
                    foundMatchId: fid,
                    message: "Fila cancelada.",
                  });
              }
              send(ws, { type: "FIND_MATCH_CANCELLED" });
              refresh(c.roomId);
              return;
            }
            if (d.type === "ACCEPT_FOUND_MATCH") {
              const found = foundMatches.get(d.foundMatchId);
              if (!found || found.expires < Date.now())
                throw fail("Proposta de fila inválida ou expirada.");
              if (![found.a, found.b].includes(u.id))
                throw fail("Você não participa desta proposta.");
              found.accepts.add(u.id);
              send(ws, {
                type: "FOUND_MATCH_ACCEPTED",
                foundMatchId: found.id,
              });
              if (found.accepts.size < 2) {
                const other = found.a === u.id ? found.b : found.a;
                send(connection(other)?.[0], {
                  type: "FOUND_MATCH_PEER_ACCEPTED",
                  foundMatchId: found.id,
                  userId: u.id,
                });
                return;
              }
              const roomA = connection(found.a)?.[1]?.roomId,
                roomB = connection(found.b)?.[1]?.roomId;
              const roomId = found.room || roomA || roomB;
              if (!roomId || !connection(found.a) || !connection(found.b))
                throw fail("Jogadores indisponíveis para iniciar.");
              if (found.stake) {
                assertDailyLossOk(found.a, found.stake);
                assertDailyLossOk(found.b, found.stake);
              }
              startMatchBetween({
                playerAId: found.a,
                playerBId: found.b,
                roomId,
                mode: found.mode,
                stake: found.stake,
                seriesBestOf: found.seriesBestOf,
              });
              clearTimeout(found.timer);
              foundMatches.delete(found.id);
              return;
            }
            if (d.type === "READY_ACK") {
              const m = matches.get(d.matchId || c.matchId);
              if (!m || ![m.a, m.b].includes(u.id))
                throw fail("Partida inválida para ready-check.");
              handleReadyAck(m, u.id);
              return;
            }
            if (d.type === "LATENCY_SAMPLE") {
              const m = matches.get(d.matchId || c.matchId);
              if (!m || ![m.a, m.b].includes(u.id)) return;
              const sample = computeCommandToImageMs({
                clientSentAt: d.clientSentAt,
                acceptedAt: d.acceptedAt,
                frameDecodedAt: d.frameDecodedAt,
              });
              if (!sample) return;
              m.latencySamples = m.latencySamples || [];
              m.latencySamples.push({ ...sample, at: Date.now(), userId: u.id });
              m.latencyStats = latencyRollingStats(m.latencySamples);
              send(ws, {
                type: "LATENCY_UPDATE",
                matchId: m.id,
                ...sample,
                stats: m.latencyStats,
              });
              return;
            }
            if (d.type === "SPECTATE_JOIN") {
              const m = matches.get(d.matchId);
              if (!m || !["LOADING", "RUNNING", "QUEUED"].includes(m.phase))
                throw fail("Partida indisponível para espectador.");
              if ([m.a, m.b].includes(u.id))
                throw fail("Participantes não entram como espectador.");
              if (!spectators.has(m.id)) spectators.set(m.id, new Set());
              spectators.get(m.id).add(u.id);
              c.spectateMatchId = m.id;
              send(ws, {
                type: "SPECTATE_STARTED",
                matchId: m.id,
                playerA: Users.getById(m.a).username,
                playerB: Users.getById(m.b).username,
                readOnly: true,
                seriesScore: m.seriesScore || { a: 0, b: 0 },
                seriesBestOf: m.seriesBestOf || 1,
              });
              return;
            }
            if (d.type === "SPECTATE_LEAVE") {
              const mid = d.matchId || c.spectateMatchId;
              if (mid && spectators.has(mid)) spectators.get(mid).delete(u.id);
              c.spectateMatchId = null;
              send(ws, { type: "SPECTATE_LEFT", matchId: mid || null });
              return;
            }
            if (d.type === "REMATCH_REQUEST") {
              // Alias legado do cliente → REMATCH_OFFER.
              d.type = "REMATCH_OFFER";
            }
            if (d.type === "REMATCH_OFFER") {
              const prev =
                rematchOffers.get(d.matchId) ||
                [...rematchOffers.values()].find(
                  (r) => [r.a, r.b].includes(u.id) && r.expires > Date.now(),
                );
              if (!prev || ![prev.a, prev.b].includes(u.id))
                throw fail("Revanche indisponível para esta partida.");
              if (prev.expires < Date.now())
                throw fail("Prazo de revanche expirado.");
              if (c.matchId || isBusyUser(u.id))
                throw fail("Já existe desafio ou partida em andamento.");
              const otherId = prev.a === u.id ? prev.b : prev.a;
              const other = connection(otherId);
              if (!other || other[1].roomId !== c.roomId)
                throw fail("Oponente precisa estar na mesma sala.");
              if (prev.stake) {
                assertDailyLossOk(u.id, prev.stake);
                assertDailyLossOk(otherId, prev.stake);
              }
              const ch = issueChallenge({
                fromId: u.id,
                toId: otherId,
                roomId: c.roomId,
                mode: prev.mode,
                stake: prev.stake,
                seriesBestOf: prev.seriesBestOf,
              });
              send(other[0], {
                type: "REMATCH_OFFERED",
                challengeId: ch.id,
                fromMatchId: prev.matchId,
                mode: ch.mode,
                stakeCents: ch.stake,
                seriesBestOf: ch.seriesBestOf,
              });
              send(ws, {
                type: "REMATCH_OFFER_SENT",
                challengeId: ch.id,
                fromMatchId: prev.matchId,
              });
              return;
            }
            if (d.type === "REMATCH_ACCEPT") {
              // Aceita o desafio gerado pelo REMATCH_OFFER (mesmo fluxo de ACCEPT_CHALLENGE).
              // Compat: requesterId legado → localiza challenge pendente.
              let challengeId = d.challengeId;
              if (!challengeId && d.requesterId) {
                const found = [...challenges.values()].find(
                  (ch) =>
                    ch.from === d.requesterId &&
                    ch.to === u.id &&
                    ch.expires > Date.now(),
                );
                challengeId = found?.id;
              }
              if (!challengeId) throw fail("challengeId obrigatório.");
              const ch = challenges.get(challengeId);
              if (!ch || ch.to !== u.id || ch.expires < Date.now())
                throw fail("Revanche inválida ou expirada.");
              if (
                (d.stakeCents !== undefined && d.stakeCents !== ch.stake) ||
                (d.mode !== undefined && d.mode !== ch.mode) ||
                (d.seriesBestOf !== undefined &&
                  d.seriesBestOf !== ch.seriesBestOf)
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
              if (ch.stake) {
                assertDailyLossOk(u.id, ch.stake);
                assertDailyLossOk(ch.from, ch.stake);
              }
              startMatchBetween({
                playerAId: ch.from,
                playerBId: u.id,
                roomId: ch.room,
                mode: ch.mode,
                stake: ch.stake,
                seriesBestOf: ch.seriesBestOf || 1,
              });
              clearTimeout(ch.timer);
              challenges.delete(ch.id);
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
                // QUEUED/LOADING: estorno limpo. Depois de RUNNING: revisão.
                if (m.phase === "LOADING" || m.phase === "QUEUED") {
                  cancel(
                    m,
                    d.type === "DISPUTE_MATCH"
                      ? "Resultado contestado. Reservas devolvidas."
                      : m.phase === "QUEUED"
                        ? "Fila cancelada. Reservas devolvidas."
                        : "Preparação ou conexão interrompida. Reservas devolvidas.",
                    d.type === "DISPUTE_MATCH",
                  );
                  return;
                }
                review(
                  m,
                  u.id,
                  d.type === "DISPUTE_MATCH"
                    ? "Resultado contestado pelo participante."
                    : "Interrupção após início solicitada pelo participante.",
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
                try {
                  replayEngine.recordInput(m.id, {
                    slot: u.id === m.a ? 1 : 2,
                    button: d.button,
                    value: d.value,
                    seq: input.seq,
                  });
                } catch {}
                if (m.worker) {
                  await m.worker.input(u.id === m.a ? 1 : 2, d.button, d.value);
                  send(ws, {
                    type: "INPUT_ACK",
                    matchId: m.id,
                    seq: input.seq,
                    slot: u.id === m.a ? 1 : 2,
                    acceptedAt: Date.now(),
                    clientSentAt: d.clientSentAt ?? null,
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
                else applyGameResult(m, a, { source: "dual-confirmation" });
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
          setTimeout(() => onGraceExpired(m, c.userId), graceMs),
        );
        both(m, {
          type: "PEER_DISCONNECTED",
          matchId: m.id,
          userId: c.userId,
          reconnectMs: graceMs,
        });
      }
      if (c.userId) {
        MatchmakingQueue.leave(c.userId);
        for (const [fid, found] of [...foundMatches.entries()]) {
          if (![found.a, found.b].includes(c.userId)) continue;
          clearTimeout(found.timer);
          foundMatches.delete(fid);
          for (const uid of [found.a, found.b])
            send(connection(uid)?.[0], {
              type: "MATCH_FOUND_EXPIRED",
              foundMatchId: fid,
              message: "Jogador saiu da fila.",
            });
        }
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
