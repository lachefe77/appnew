import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import WebSocket from "ws";
import { wsRateLimit, wsCleanup } from "../server/ratelimit.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test(
  "autenticação, reservas, duelos e recuperação",
  { timeout: 120000 },
  async (t) => {
    fs.mkdirSync(path.join(root, "work"), { recursive: true });
    const dir = fs.mkdtempSync(path.join(root, "work/regression-")),
      dbPath = path.join(dir, "arena.db");
    const reserve = net.createServer();
    await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
    const port = reserve.address().port;
    await new Promise((r) => reserve.close(r));
    const env = {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      DB_PATH: dbPath,
      NODE_ENV: "development",
      ENABLE_SIMULATED_FUNDS: "1",
      ADMIN_PASSWORD: "TestOnly_123456",
      DOTENV_CONFIG_PATH: path.join(dir, "absent.env"),
      RECONNECT_GRACE_MS: "500",
      RESULT_CONFIRM_MS: "350",
      MATCH_REVIEW_MS: "2500",
      MATCH_LOADING_MS: "5000",
    };
    let child,
      db,
      log = "";
    const sockets = [];
    const base = "http://127.0.0.1:" + port;
    async function request(endpoint, data, token) {
      const r = await fetch(base + endpoint, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        signal: AbortSignal.timeout(3000),
      });
      const raw = await r.text();
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
      return { status: r.status, body };
    }
    async function boot() {
      child = spawn(process.execPath, ["tests/fixtures/hosted-platform.js"], {
        cwd: root,
        env,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      child.stdout.on("data", (d) => (log += d));
      child.stderr.on("data", (d) => (log += d));
      for (let i = 0; i < 80; i++) {
        if (child.exitCode !== null) throw Error(log);
        try {
          if ((await request("/health")).status === 200) return;
        } catch {}
        await delay(50);
      }
      throw Error(log);
    }
    async function connect() {
      const ws = new WebSocket("ws://127.0.0.1:" + port + "/ws", {
        origin: base,
      });
      sockets.push(ws);
      const messages = [];
      ws.on("message", (r) => messages.push(JSON.parse(r)));
      await new Promise((r, j) => {
        ws.once("open", r);
        ws.once("error", j);
      });
      const c = {
        ws,
        send: (d) => ws.send(JSON.stringify(d)),
        async wait(type, predicate = () => true, ms = 2500) {
          const start = Date.now();
          while (Date.now() - start < ms) {
            const i = messages.findIndex(
              (m) => m.type === type && predicate(m),
            );
            if (i >= 0) return messages.splice(i, 1)[0];
            await delay(5);
          }
          throw Error("Timeout " + type + " " + JSON.stringify(messages));
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
        email: name + "@example.test",
        password: "TestOnly_123456",
      });
      c.auth = await c.wait("AUTH_SUCCESS");
      return c;
    }
    const balance = (id) =>
      db.prepare("SELECT balance,locked FROM wallets WHERE user_id=?").get(id);
    t.after(async () => {
      for (const ws of sockets) ws.terminate();
      if (child?.exitCode === null) {
        const exited = new Promise((r) => child.once("exit", r));
        child.kill("SIGTERM");
        const force = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {}
        }, 3000);
        await exited;
        clearTimeout(force);
      }
      try {
        db?.close();
      } catch {}
      fs.writeFileSync(path.join(dir, "server.log"), log);
    });
    await boot();
    db = new Database(dbPath);
    let a = await register("Player_A"),
      b = await register("Player_B"),
      c = await register("Player_C");
    const admin = await connect();
    admin.send({
      type: "LOGIN_ACCOUNT",
      email: "admin@arena.gg",
      password: env.ADMIN_PASSWORD,
    });
    admin.auth = await admin.wait("AUTH_SUCCESS");
    const token = admin.auth.sessionToken;
    const rooms = (await request("/api/rooms")).body;
    const room = rooms[0].id;
    for (const player of [a, b, c]) {
      player.send({ type: "JOIN_ROOM", roomId: room });
      await player.wait("ROOM_JOINED");
    }
    async function invite() {
      a.send({
        type: "SEND_CHALLENGE",
        targetUserId: b.auth.user.id,
        mode: "APOSTADO",
        stakeCents: 500,
      });
      const ch = await b.wait("CHALLENGE_RECEIVED");
      return ch;
    }
    async function match() {
      const ch = await invite();
      b.send({ type: "ACCEPT_CHALLENGE", challengeId: ch.challengeId });
      const m = await a.wait("MATCH_STARTED");
      b.match = await b.wait("MATCH_STARTED");
      a.match = m;
      return m;
    }
    async function ready(m) {
      for (const p of [a, b])
        p.send({ type: "GAME_READY", matchId: m.matchId });
      await a.wait("GAME_RUNNING");
      await b.wait("GAME_RUNNING");
    }
    await t.test(
      "WebSocket recusa origem externa e rota indevida",
      async () => {
        for (const [endpoint, origin] of [
          ["/ws", "https://external.example"],
          ["/not-ws", base],
        ]) {
          const status = await new Promise((resolve, reject) => {
            const ws = new WebSocket("ws://127.0.0.1:" + port + endpoint, {
              origin,
            });
            ws.once("unexpected-response", (_req, res) => {
              res.resume();
              ws.terminate();
              resolve(res.statusCode);
            });
            ws.once("open", () => {
              ws.terminate();
              reject(Error("Upgrade indevido"));
            });
            ws.on("error", () => {});
          });
          assert.equal(status, 403);
        }
      },
    );
    await t.test(
      "JSON malformado e mensagens sem objeto não derrubam servidor",
      async () => {
        const visitor = await connect();
        for (const value of [
          "{",
          "null",
          "[]",
          '"LOGIN_ACCOUNT"',
          '{"type":42}',
        ]) {
          visitor.ws.send(value);
          assert.equal((await visitor.wait("ERROR_NOTICE")).code, 400);
        }
        visitor.send({ type: "PING" });
        await visitor.wait("PONG");
        visitor.ws.close();
        assert.equal((await request("/health")).status, 200);
      },
    );
    await t.test("visitante não move dinheiro nem aprova KYC", async () => {
      const visitor = await connect();
      const before = balance(a.auth.user.id);
      for (const type of [
        "DEPOSIT_PIX",
        "WITHDRAW_PIX",
        "ADMIN_DECIDE_KYC",
        "REPORT_MATCH_RESULT",
      ]) {
        visitor.send({
          type,
          amountCents: 100,
          userId: a.auth.user.id,
          userEmail: a.auth.user.email,
          decision: "APROVADO",
        });
        assert.equal((await visitor.wait("AUTH_ERROR")).code, 401);
      }
      assert.deepEqual(balance(a.auth.user.id), before);
      visitor.ws.close();
    });
    await t.test(
      "usuário comum não acessa dados nem ações administrativas",
      async () => {
        for (const endpoint of [
          "/api/admin/dashboard",
          "/api/admin/audit-log",
          "/api/admin/reconciliation",
          "/api/admin/export-csv",
        ]) {
          assert.equal(
            (await request(endpoint, undefined, a.auth.sessionToken)).status,
            403,
          );
        }
        assert.equal(
          (
            await request(
              "/api/admin/action",
              { userId: a.auth.user.id, action: "credit", amountCents: 99999 },
              a.auth.sessionToken,
            )
          ).status,
          403,
        );
        c.send({
          type: "ADMIN_DECIDE_KYC",
          userEmail: a.auth.user.email,
          decision: "APROVADO",
        });
        assert.equal((await c.wait("AUTH_ERROR")).code, 403);
      },
    );
    await t.test(
      "injeção no login não autentica e nick HTML não é cadastrado",
      async () => {
        const visitor = await connect();
        visitor.send({
          type: "LOGIN_ACCOUNT",
          email: "' OR 1=1 --",
          password: "TestOnly_123456",
        });
        await visitor.wait("ERROR_NOTICE");
        visitor.send({
          type: "LOGIN_ACCOUNT",
          email: "absent@example.test",
          password: "' OR 1=1 --",
        });
        assert.equal((await visitor.wait("AUTH_ERROR")).code, 401);
        visitor.send({
          type: "REGISTER_ACCOUNT",
          email: "html@example.test",
          username: "<img src=x onerror=1>",
          password: "TestOnly_123456",
        });
        await visitor.wait("ERROR_NOTICE");
        assert.equal(
          db
            .prepare("SELECT count(*) n FROM users WHERE email=?")
            .get("html@example.test").n,
          0,
        );
        visitor.ws.close();
      },
    );
    await t.test(
      "payload WS acima de 512 KiB fecha a conexão sem parar o servidor",
      async () => {
        const visitor = await connect();
        const closed = new Promise((resolve) =>
          visitor.ws.once("close", resolve),
        );
        visitor.ws.send("x".repeat(512 * 1024 + 1));
        assert.equal(await closed, 1009);
        assert.equal((await request("/health")).status, 200);
      },
    );
    await t.test(
      "arquivos privados não são publicados e resposta tem nosniff",
      async () => {
        for (const endpoint of [
          "/.env",
          "/server/db.js",
          "/data/arena.db",
          "/package-lock.json",
        ]) {
          assert.notEqual((await request(endpoint)).status, 200);
        }
        const response = await fetch(base + "/");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.equal(response.headers.get("x-frame-options"), "DENY");
      },
    );
    await t.test("extrato e cupom exigem sessão e titularidade", async () => {
      assert.equal(
        (await request("/api/transactions?userId=" + a.auth.user.id)).status,
        401,
      );
      assert.equal(
        (
          await request("/api/coupon/redeem", {
            code: "KOFBRASIL",
            userId: a.auth.user.id,
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request(
            "/api/transactions?userId=" + b.auth.user.id,
            undefined,
            a.auth.sessionToken,
          )
        ).status,
        403,
      );
    });
    await t.test(
      "cupom só credita uma vez e não conta como depósito",
      async () => {
        const before = balance(a.auth.user.id).balance;
        assert.equal(
          (
            await request(
              "/api/coupon/redeem",
              { code: "KOFBRASIL" },
              a.auth.sessionToken,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await request(
              "/api/coupon/redeem",
              { code: "KOFBRASIL" },
              a.auth.sessionToken,
            )
          ).status,
          400,
        );
        assert.equal(balance(a.auth.user.id).balance, before + 500);
        assert.equal(
          db
            .prepare("SELECT total_deposit n FROM wallets WHERE user_id=?")
            .get(a.auth.user.id).n,
          0,
        );
      },
    );
    await t.test(
      "paths externos e barras codificadas são bloqueados",
      async () => {
        for (const raw of [
          "/../package.json",
          "/%2e%2e/package.json",
          "/..%5cpackage.json",
        ]) {
          const r = await new Promise((resolve, reject) =>
            httpGetRaw(raw, resolve, reject),
          );
          assert.notEqual(r.status, 200);
          assert.ok(!r.body.includes('"dependencies"'));
        }
      },
    );
    function httpGetRaw(raw, resolve, reject) {
      http
        .get({ hostname: "127.0.0.1", port, path: raw }, (r) => {
          let body = "";
          r.on("data", (c) => (body += c));
          r.on("end", () => resolve({ status: r.statusCode, body }));
        })
        .on("error", reject);
    }
    await t.test(
      "convite inexistente e auto-desafio não bloqueiam saldo",
      async () => {
        const before = balance(a.auth.user.id);
        b.send({
          type: "ACCEPT_CHALLENGE",
          fromUserId: a.auth.user.id,
          mode: "APOSTADO",
          stakeCents: 500,
        });
        await b.wait("ERROR_NOTICE");
        a.send({
          type: "SEND_CHALLENGE",
          targetUserId: a.auth.user.id,
          mode: "APOSTADO",
          stakeCents: 500,
        });
        await a.wait("ERROR_NOTICE");
        assert.deepEqual(balance(a.auth.user.id), before);
      },
    );
    await t.test("aceite adulterado ou por terceiro é rejeitado", async () => {
      const ch = await invite();
      c.send({ type: "ACCEPT_CHALLENGE", challengeId: ch.challengeId });
      await c.wait("ERROR_NOTICE");
      b.send({
        type: "ACCEPT_CHALLENGE",
        challengeId: ch.challengeId,
        stakeCents: 1000,
      });
      await b.wait("ERROR_NOTICE");
      assert.equal(balance(a.auth.user.id).locked, 0);
      b.send({ type: "DECLINE_CHALLENGE", challengeId: ch.challengeId });
      await b.wait("CHALLENGE_EXPIRED");
    });
    await t.test(
      "falha no segundo bloqueio reverte primeira reserva e criação da partida",
      async () => {
        const beforeA = balance(a.auth.user.id),
          beforeB = balance(b.auth.user.id),
          ch = await invite();
        db.exec(
          `CREATE TRIGGER injected_failure BEFORE UPDATE ON wallets WHEN NEW.user_id='${b.auth.user.id}' AND NEW.locked>OLD.locked BEGIN SELECT RAISE(ABORT,'Falha induzida'); END;`,
        );
        try {
          b.send({ type: "ACCEPT_CHALLENGE", challengeId: ch.challengeId });
          await b.wait("ERROR_NOTICE");
          assert.deepEqual(balance(a.auth.user.id), beforeA);
          assert.deepEqual(balance(b.auth.user.id), beforeB);
          assert.equal(db.prepare("SELECT COUNT(*) n FROM matches").get().n, 0);
        } finally {
          db.exec("DROP TRIGGER injected_failure");
        }
        b.send({ type: "DECLINE_CHALLENGE", challengeId: ch.challengeId });
        await b.wait("CHALLENGE_EXPIRED");
      },
    );
    await t.test("limites de controle são independentes dos comandos", () => {
      const socket = {};
      for (let i = 0; i < 180; i++)
        assert.equal(wsRateLimit(socket, "PLAYER_INPUT"), true);
      assert.equal(wsRateLimit(socket, "PLAYER_INPUT"), false);
      assert.equal(wsRateLimit(socket, "SEND_CHAT"), true);
      wsCleanup(socket);
    });
    await t.test(
      "criação e liquidação debitam reservas e creditam prêmio uma vez",
      async () => {
        const beforeA = balance(a.auth.user.id).balance,
          beforeB = balance(b.auth.user.id).balance;
        const m = await match();
        assert.deepEqual(balance(a.auth.user.id), {
          balance: beforeA - 500,
          locked: 500,
        });
        await ready(m);
        c.send({
          type: "PLAYER_INPUT",
          matchId: m.matchId,
          button: 0,
          value: 1,
        });
        await c.wait("AUTH_ERROR");
        a.send({
          type: "REPORT_MATCH_RESULT",
          matchId: m.matchId,
          winnerId: c.auth.user.id,
        });
        await a.wait("AUTH_ERROR");
        b.send({
          type: "PLAYER_INPUT",
          matchId: m.matchId,
          button: 0,
          value: 1,
          epoch: b.match.inputEpoch,
          seq: 1,
        });
        const input = await b.wait("INPUT_ACK");
        assert.equal(input.slot, 2);
        for (const p of [a, b])
          p.send({
            type: "REPORT_MATCH_RESULT",
            matchId: m.matchId,
            winnerId: a.auth.user.id,
          });
        for (const player of [a, b])
          assert.equal((await player.wait("AUTH_ERROR")).code, 403);
        child.send({
          type: "FIXTURE_RESULT",
          matchId: m.matchId,
          winnerSlot: 1,
        });
        await a.wait("MATCH_ENDED");
        assert.deepEqual(balance(a.auth.user.id), {
          balance: beforeA + 400,
          locked: 0,
        });
        assert.deepEqual(balance(b.auth.user.id), {
          balance: beforeB - 500,
          locked: 0,
        });
        assert.equal(
          db
            .prepare(
              "SELECT SUM(delta) n FROM finance_entries WHERE account='platform:revenue'",
            )
            .get().n,
          100,
        );
        a.send({
          type: "REPORT_MATCH_RESULT",
          matchId: m.matchId,
          winnerId: a.auth.user.id,
        });
        await a.wait("AUTH_ERROR");
        assert.equal(balance(a.auth.user.id).balance, beforeA + 400);
      },
    );
    await t.test(
      "divergência preserva reservas até decisão administrativa idempotente",
      async () => {
        const before = balance(a.auth.user.id);
        const m = await match();
        await ready(m);
        a.send({ type: "DISPUTE_MATCH", matchId: m.matchId });
        await a.wait("MATCH_REVIEW_OPENED");
        assert.deepEqual(balance(a.auth.user.id), {
          balance: before.balance - 500,
          locked: 500,
        });
        const endpoint = "/api/admin/match-reviews/" + m.matchId;
        assert.equal(
          (
            await request(
              endpoint,
              {
                decision: "REFUND",
                reason:
                  "Resultados divergentes sem prova conclusiva; estorno de demonstração.",
              },
              a.auth.sessionToken,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              endpoint,
              {
                decision: "REFUND",
                reason:
                  "Resultados divergentes sem prova conclusiva; estorno de demonstração.",
              },
              token,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await request(
              endpoint,
              {
                decision: "REFUND",
                reason:
                  "Repetição da decisão de estorno para teste de idempotência.",
              },
              token,
            )
          ).body.repeated,
          true,
        );
        assert.equal(
          (
            await request(
              endpoint,
              {
                decision: "PLAYER_A",
                reason:
                  "Tentativa de decisão conflitante depois de revisão encerrada.",
              },
              token,
            )
          ).status,
          400,
        );
        assert.deepEqual(balance(a.auth.user.id), before);
        assert.equal(
          db
            .prepare(
              "SELECT COUNT(*) n FROM transactions WHERE ref_id=? AND type='RESERVE_RELEASE'",
            )
            .get(m.matchId).n,
          2,
        );
      },
    );
    await t.test("revisão tem prazo e não deixa saldo preso", async () => {
      const before = balance(a.auth.user.id);
      const m = await match();
      await ready(m);
      a.send({
        type: "DISPUTE_MATCH",
        matchId: m.matchId,
        winnerId: a.auth.user.id,
      });
      await a.wait("MATCH_REVIEW_OPENED");
      assert.equal(balance(a.auth.user.id).locked, 500);
      await a.wait(
        "MATCH_REVIEW_CLOSED",
        (m) => m.matchId === a.match.matchId,
        5000,
      );
      assert.deepEqual(balance(a.auth.user.id), before);
    });
    await t.test(
      "controles de P1/P2 têm porta fixa, sequência e validação de estado",
      async () => {
        const m = await match();
        await ready(m);
        let seq = 0;
        const inputA = (button, value, extra = {}) =>
          a.send({
            type: "PLAYER_INPUT",
            matchId: m.matchId,
            epoch: a.match.inputEpoch,
            seq: ++seq,
            button,
            value,
            ...extra,
          });
        inputA(0, 1);
        assert.equal((await a.wait("INPUT_ACK")).slot, 1);
        a.send({
          type: "PLAYER_INPUT",
          matchId: m.matchId,
          epoch: a.match.inputEpoch,
          seq: 1,
          button: 0,
          value: 1,
        });
        await a.wait("ERROR_NOTICE");
        inputA(0, 1);
        await a.wait("ERROR_NOTICE");
        inputA(4, 1);
        await a.wait("INPUT_ACK");
        inputA(5, 1);
        await a.wait("ERROR_NOTICE");
        inputA(4, 0);
        await a.wait("INPUT_ACK");
        inputA(5, 1);
        await a.wait("INPUT_ACK");
        inputA(15, 1);
        await a.wait("ERROR_NOTICE");
        inputA(5, 0);
        await a.wait("INPUT_ACK");
        b.send({
          type: "PLAYER_INPUT",
          matchId: m.matchId,
          epoch: b.match.inputEpoch,
          seq: 1,
          button: 8,
          value: 1,
          slot: 1,
        });
        await b.wait("ERROR_NOTICE");
        b.send({
          type: "PLAYER_INPUT",
          matchId: m.matchId,
          epoch: b.match.inputEpoch,
          seq: 1,
          button: 8,
          value: 1,
        });
        assert.equal((await b.wait("INPUT_ACK")).slot, 2);
        assert.equal(
          db
            .prepare(
              "SELECT count(*) n FROM match_events WHERE match_id=? AND kind='INPUT_ACCEPTED'",
            )
            .get(m.matchId).n,
          6,
        );
        a.send({ type: "CANCEL_MATCH", matchId: m.matchId });
        await a.wait("MATCH_REVIEW_OPENED");
        assert.equal(
          (
            await request(
              "/api/admin/match-reviews/" + m.matchId,
              {
                decision: "REFUND",
                reason:
                  "Fim do ensaio de protocolo sem partida oficial; créditos de teste.",
              },
              token,
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      "regras e eventos imutáveis possuem cadeia de hashes e acesso restrito",
      async () => {
        const m = await match();
        assert.equal(m.rules.protocol, 2);
        assert.equal(m.rules.authority, "server-session");
        assert.throws(
          () =>
            db
              .prepare("UPDATE match_rules SET payload='{}' WHERE match_id=?")
              .run(m.matchId),
          /imutáveis/,
        );
        assert.throws(
          () =>
            db
              .prepare("DELETE FROM match_events WHERE match_id=?")
              .run(m.matchId),
          /imutáveis/,
        );
        assert.equal(
          (
            await request(
              "/api/matches/" + m.matchId + "/integrity",
              undefined,
              c.auth.sessionToken,
            )
          ).status,
          403,
        );
        a.send({ type: "GAME_READY", matchId: m.matchId });
        await delay(20);
        a.send({ type: "CANCEL_MATCH", matchId: m.matchId });
        await a.wait("MATCH_CANCELLED");
        const data = (
          await request(
            "/api/matches/" + m.matchId + "/integrity",
            undefined,
            a.auth.sessionToken,
          )
        ).body;
        let previous = "";
        for (const [i, event] of data.events.entries()) {
          assert.equal(event.seq, i + 1);
          assert.equal(event.previous_hash, previous);
          assert.equal(
            event.hash,
            crypto
              .createHash("sha256")
              .update(
                JSON.stringify([
                  event.match_id,
                  event.seq,
                  event.at_ms,
                  event.actor,
                  event.kind,
                  event.payload,
                  previous,
                ]),
              )
              .digest("hex"),
          );
          previous = event.hash;
        }
        assert.equal(data.events.at(-1).kind, "CANCELLED_BEFORE_START");
      },
    );
    await t.test(
      "falha declarada depois do início abre revisão sem estorno imediato",
      async () => {
        const before = balance(a.auth.user.id);
        const m = await match();
        await ready(m);
        b.send({ type: "GAME_FAILED", matchId: m.matchId });
        await a.wait("MATCH_REVIEW_OPENED");
        assert.deepEqual(balance(a.auth.user.id), {
          balance: before.balance - 500,
          locked: 500,
        });
        assert.equal(
          db
            .prepare("SELECT phase FROM match_state WHERE match_id=?")
            .get(m.matchId).phase,
          "REVIEW",
        );
        assert.equal(
          (
            await request("/api/my-reviews", undefined, a.auth.sessionToken)
          ).body.reviews.some((r) => r.match_id === m.matchId),
          true,
        );
        assert.equal(
          (
            await request("/api/my-reviews", undefined, c.auth.sessionToken)
          ).body.reviews.some((r) => r.match_id === m.matchId),
          false,
        );
        assert.equal(
          (
            await request(
              "/api/admin/match-reviews/" + m.matchId,
              { decision: "REFUND", reason: "curto" },
              token,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "/api/admin/match-reviews/" + m.matchId,
              {
                decision: "REFUND",
                reason:
                  "Emulação perdida depois do início; não há evidência conclusiva de vitória.",
              },
              token,
            )
          ).status,
          200,
        );
        assert.deepEqual(balance(a.auth.user.id), before);
      },
    );
    await t.test(
      "reconexão invalida epoch anterior e mantém controles da nova sessão",
      async () => {
        const m = await match();
        await ready(m);
        const oldEpoch = b.match.inputEpoch,
          auth = b.auth;
        b.ws.close();
        await a.wait("PEER_DISCONNECTED");
        b = await connect();
        b.auth = auth;
        b.send({ type: "REAUTH", token: auth.sessionToken });
        await b.wait("AUTH_SUCCESS");
        b.match = await b.wait("MATCH_RESUMED");
        assert.notEqual(b.match.inputEpoch, oldEpoch);
        b.send({
          type: "PLAYER_INPUT",
          matchId: m.matchId,
          epoch: oldEpoch,
          seq: 1,
          button: 0,
          value: 1,
        });
        await b.wait("ERROR_NOTICE");
        b.send({
          type: "PLAYER_INPUT",
          matchId: m.matchId,
          epoch: b.match.inputEpoch,
          seq: 1,
          button: 0,
          value: 1,
        });
        await b.wait("INPUT_ACK");
        a.send({ type: "CANCEL_MATCH", matchId: m.matchId });
        await a.wait("MATCH_REVIEW_OPENED");
        await request(
          "/api/admin/match-reviews/" + m.matchId,
          {
            decision: "REFUND",
            reason:
              "Encerramento de cenário de reconexão com créditos de demonstração.",
          },
          token,
        );
      },
    );
    await t.test(
      "revisão persiste após reinício e decisão financeira ocorre uma vez",
      async () => {
        const beforeA = balance(a.auth.user.id).balance,
          beforeB = balance(b.auth.user.id).balance;
        const m = await match();
        await ready(m);
        a.send({ type: "DISPUTE_MATCH", matchId: m.matchId });
        await a.wait("MATCH_REVIEW_OPENED");
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await exited;
        await boot();
        assert.equal(balance(a.auth.user.id).locked, 500);
        const endpoint = "/api/admin/match-reviews/" + m.matchId;
        assert.equal(
          (
            await request(
              endpoint,
              {
                decision: "PLAYER_B",
                reason:
                  "Decisão administrativa fictícia para validar liquidação transacional, sem certificar vencedor real.",
              },
              token,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await request(
              endpoint,
              {
                decision: "PLAYER_B",
                reason:
                  "Repetição idempotente da decisão administrativa fictícia para teste.",
              },
              token,
            )
          ).body.repeated,
          true,
        );
        assert.deepEqual(balance(a.auth.user.id), {
          balance: beforeA - 500,
          locked: 0,
        });
        assert.deepEqual(balance(b.auth.user.id), {
          balance: beforeB + 400,
          locked: 0,
        });
        for (const player of [a, b, c, admin]) player.ws.terminate();
        const authA = a.auth,
          authB = b.auth,
          authC = c.auth;
        a = await connect();
        a.auth = authA;
        b = await connect();
        b.auth = authB;
        c = await connect();
        c.auth = authC;
        for (const player of [a, b, c]) {
          player.send({ type: "REAUTH", token: player.auth.sessionToken });
          await player.wait("AUTH_SUCCESS");
          player.send({ type: "JOIN_ROOM", roomId: room });
          await player.wait("ROOM_JOINED");
        }
      },
    );
    await t.test(
      "créditos não aceitam sessão local nem resultado inventado por jogador",
      async () => {
        const before = balance(a.auth.user.id),
          m = await match();
        await ready(m);
        assert.equal(m.transport, "server-stream");
        assert.equal(m.rules.resultMode, "server-observer");
        for (const type of [
          "REPORT_MATCH_RESULT",
          "SERVER_RESULT",
          "MATCH_ENDED",
          "DETECTOR_RESULT",
        ]) {
          a.send({
            type,
            matchId: m.matchId,
            winnerId: a.auth.user.id,
            winnerSlot: 1,
          });
          await a.wait(
            type === "REPORT_MATCH_RESULT" ? "AUTH_ERROR" : "ERROR_NOTICE",
          );
        }
        assert.deepEqual(balance(a.auth.user.id), {
          balance: before.balance - 500,
          locked: 500,
        });
        a.send({
          type: "PLAYER_INPUT",
          matchId: m.matchId,
          epoch: m.inputEpoch,
          seq: 1,
          button: 2,
          value: 1,
        });
        await a.wait("ERROR_NOTICE");
        a.send({
          type: "MATCH_SIGNAL",
          matchId: m.matchId,
          signal: { kind: "offer", sdp: { type: "offer", sdp: "fake" } },
        });
        await a.wait("ERROR_NOTICE");
        a.send({ type: "CANCEL_MATCH", matchId: m.matchId });
        await a.wait("MATCH_REVIEW_OPENED");
        await request(
          "/api/admin/match-reviews/" + m.matchId,
          {
            decision: "REFUND",
            reason:
              "Fim do cenário de proteção da autoridade contra declarações falsas do cliente.",
          },
          token,
        );
      },
    );
    await t.test(
      "amistoso preserva execução local e não reserva crédito",
      async () => {
        const before = balance(a.auth.user.id);
        a.send({
          type: "SEND_CHALLENGE",
          targetUserId: b.auth.user.id,
          mode: "AMISTOSO",
        });
        const invite = await b.wait("CHALLENGE_RECEIVED");
        b.send({ type: "ACCEPT_CHALLENGE", challengeId: invite.challengeId });
        const m = await a.wait("MATCH_STARTED");
        await b.wait("MATCH_STARTED");
        assert.equal(m.transport, "host-stream");
        assert.equal(m.rules.authority, "untrusted-player-host");
        assert.deepEqual(balance(a.auth.user.id), before);
        await ready(m);
        for (const player of [a, b])
          player.send({
            type: "REPORT_MATCH_RESULT",
            matchId: m.matchId,
            winnerId: a.auth.user.id,
          });
        await a.wait("MATCH_ENDED");
        assert.deepEqual(balance(a.auth.user.id), before);
      },
    );
    await t.test(
      "ROM, BIOS e controle interno do worker não são arquivos públicos",
      async () => {
        for (const endpoint of [
          "/data/hosted/kof2002/kof2002.zip",
          "/data/hosted/kof2002/neogeo.zip",
          "/server/hosted-worker.js",
          "/server/hosted-session.js",
        ])
          assert.notEqual((await request(endpoint)).status, 200);
      },
    );
    await t.test("saques inválidos não alteram carteira", async () => {
      await request(
        "/api/admin/action",
        { action: "APPROVE_KYC", userId: a.auth.user.id },
        token,
      );
      const before = balance(a.auth.user.id);
      for (const amount of [-500, 0, 1.5, "500", null]) {
        a.send({
          type: "WITHDRAW_PIX",
          amountCents: amount,
          pixKey: "test@example.test",
        });
        await a.wait("ERROR_NOTICE");
        assert.deepEqual(balance(a.auth.user.id), before);
      }
    });
    await t.test(
      "rejeição repetida é idempotente e aprovação posterior é recusada",
      async () => {
        const before = balance(a.auth.user.id);
        a.send({
          type: "WITHDRAW_PIX",
          amountCents: 500,
          pixKey: "test@example.test",
        });
        const msg = await a.wait("SYSTEM_MESSAGE", (m) => !!m.withdrawalId);
        const route = "/api/admin/withdrawal/reject",
          data = { withdrawalId: msg.withdrawalId };
        assert.equal((await request(route, data, token)).status, 200);
        assert.equal((await request(route, data, token)).body.repeated, true);
        assert.deepEqual(balance(a.auth.user.id), before);
        assert.equal(
          (await request("/api/admin/withdrawal/approve", data, token)).status,
          400,
        );
      },
    );
    await t.test(
      "banco rejeita saldos negativos e rollback não deixa meio bloqueio",
      async () => {
        assert.throws(() =>
          db
            .prepare("UPDATE wallets SET balance=-1 WHERE user_id=?")
            .run(a.auth.user.id),
        );
        const m = await match();
        a.send({ type: "CANCEL_MATCH", matchId: m.matchId });
        await a.wait("MATCH_CANCELLED");
        assert.equal(balance(a.auth.user.id).locked, 0);
      },
    );
    await t.test(
      "aprovação repetida só consome uma reserva e contabiliza um saque",
      async () => {
        a.send({
          type: "WITHDRAW_PIX",
          amountCents: 100,
          pixKey: "test@example.test",
        });
        const msg = await a.wait("SYSTEM_MESSAGE", (m) => !!m.withdrawalId),
          data = { withdrawalId: msg.withdrawalId };
        assert.equal(
          (await request("/api/admin/withdrawal/approve", data, token)).status,
          200,
        );
        assert.equal(
          (await request("/api/admin/withdrawal/approve", data, token)).body
            .repeated,
          true,
        );
        assert.equal(
          (await request("/api/admin/withdrawal/reject", data, token)).status,
          400,
        );
        assert.equal(
          db
            .prepare("SELECT total_withdraw n FROM wallets WHERE user_id=?")
            .get(a.auth.user.id).n,
          100,
        );
        assert.equal(balance(a.auth.user.id).locked, 0);
      },
    );
    await t.test("reconexão reanexa conta e cancela timer antigo", async () => {
      const m = await match();
      const auth = a.auth;
      a.ws.close();
      await b.wait("PEER_DISCONNECTED");
      a = await connect();
      a.auth = auth;
      a.send({ type: "REAUTH", token: auth.sessionToken });
      assert.equal(
        (await a.wait("AUTH_SUCCESS")).user.currentMatchId,
        m.matchId,
      );
      await a.wait("MATCH_RESUMED");
      await delay(650);
      assert.equal((await request("/health")).body.activeMatches, 1);
      a.send({ type: "CANCEL_MATCH", matchId: m.matchId });
      await a.wait("MATCH_CANCELLED");
    });
    await t.test("falha de preparação devolve reservas aos dois", async () => {
      const before = balance(a.auth.user.id);
      const m = await match();
      a.send({ type: "GAME_FAILED", matchId: m.matchId });
      await b.wait("MATCH_CANCELLED", (x) => x.matchId === m.matchId);
      assert.deepEqual(balance(a.auth.user.id), before);
    });
    await t.test(
      "interrupção abrupta recupera reservas e preserva IDs das salas",
      async () => {
        const before = balance(a.auth.user.id);
        const m = await match();
        const exited = new Promise((r) => child.once("exit", r));
        child.kill();
        await exited;
        for (const p of [a, b, c, admin]) p.ws.terminate();
        await boot();
        assert.equal((await request("/health")).body.activeMatches, 0);
        assert.equal((await request("/api/rooms")).body[0].id, room);
        assert.deepEqual(balance(a.auth.user.id), before);
        assert.equal(
          db.prepare("SELECT status FROM matches WHERE id=?").get(m.matchId)
            .status,
          "CANCELLED",
        );
      },
    );
    await t.test(
      "sessão expirada e token de admin rebaixado perdem acesso",
      async () => {
        const expiry = new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
        db.prepare(
          "INSERT INTO sessions(token,user_id,email,role,expires_at) VALUES(?,?,?,?,?)",
        ).run(
          "expired",
          admin.auth.user.id,
          admin.auth.user.email,
          "ADMIN",
          expiry,
        );
        assert.equal(
          (await request("/api/admin/overview", undefined, "expired")).status,
          401,
        );
        db.prepare("UPDATE users SET role='USER' WHERE id=?").run(
          admin.auth.user.id,
        );
        assert.equal(
          (await request("/api/admin/overview", undefined, token)).status,
          403,
        );
      },
    );
    await t.test(
      "produção ignora flag de simulação e bloqueia depósito e duelo com saldo",
      async () => {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill("SIGTERM");
        const exitTimer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {}
        }, 3000);
        await exited;
        clearTimeout(exitTimer);
        env.NODE_ENV = "production";
        env.ENABLE_SIMULATED_FUNDS = "1";
        await boot();
        assert.equal((await request("/api/config")).body.simulation, false);
        const x = await register("Production_X"),
          y = await register("Production_Y");
        assert.deepEqual(balance(x.auth.user.id), { balance: 0, locked: 0 });
        x.send({ type: "DEPOSIT_PIX", amountCents: 10000 });
        assert.equal((await x.wait("ERROR_NOTICE")).code, 409);
        for (const player of [x, y]) {
          player.send({ type: "JOIN_ROOM", roomId: room });
          await player.wait("ROOM_JOINED");
        }
        x.send({
          type: "SEND_CHALLENGE",
          targetUserId: y.auth.user.id,
          mode: "APOSTADO",
          stakeCents: 500,
        });
        assert.equal((await x.wait("ERROR_NOTICE")).code, 409);
        assert.deepEqual(balance(x.auth.user.id), { balance: 0, locked: 0 });
        assert.equal((await request("/health")).body.activeMatches, 0);
      },
    );
    await t.test(
      "contabilidade balanceada e saldo conciliado após todos os cenários",
      async () => {
        assert.equal((await request("/health")).body.reconciliation, true);
        assert.equal(
          db
            .prepare("SELECT COALESCE(SUM(delta),0) n FROM finance_entries")
            .get().n,
          0,
        );
        assert.equal(
          db
            .prepare(
              "SELECT COUNT(*) n FROM finance_events e WHERE (SELECT COALESCE(SUM(delta),0) FROM finance_entries WHERE event_id=e.id)!=0",
            )
            .get().n,
          0,
        );
      },
    );
  },
);
import http from "node:http";
import crypto from "node:crypto";
