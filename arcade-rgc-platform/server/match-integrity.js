import crypto from "node:crypto";
import db from "./db.js";
import { finance } from "./finance.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS match_rules(match_id TEXT PRIMARY KEY REFERENCES matches(id), payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS match_events(match_id TEXT NOT NULL REFERENCES matches(id), seq INTEGER NOT NULL, at_ms INTEGER NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(match_id,seq));
  CREATE TABLE IF NOT EXISTS match_reviews(match_id TEXT PRIMARY KEY REFERENCES matches(id), status TEXT NOT NULL DEFAULT 'OPEN', reason TEXT NOT NULL, opened_by TEXT NOT NULL, opened_at INTEGER NOT NULL, deadline_at INTEGER NOT NULL, decision TEXT, decision_reason TEXT, decided_by TEXT, decided_at INTEGER, evidence TEXT);
  CREATE TRIGGER IF NOT EXISTS match_rules_no_update BEFORE UPDATE ON match_rules BEGIN SELECT RAISE(ABORT,'Regras imutáveis'); END;
  CREATE TRIGGER IF NOT EXISTS match_rules_no_delete BEFORE DELETE ON match_rules BEGIN SELECT RAISE(ABORT,'Regras imutáveis'); END;
  CREATE TRIGGER IF NOT EXISTS match_events_no_update BEFORE UPDATE ON match_events BEGIN SELECT RAISE(ABORT,'Eventos imutáveis'); END;
  CREATE TRIGGER IF NOT EXISTS match_events_no_delete BEFORE DELETE ON match_events BEGIN SELECT RAISE(ABORT,'Eventos imutáveis'); END;
`);

try {
  db.exec(`ALTER TABLE match_reviews ADD COLUMN evidence TEXT`);
} catch {
  /* coluna já existe */
}

export const allowedButtons = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
export const SERIES_BEST_OF = Object.freeze([1, 3, 5]);

/** Vitórias necessárias para fechar a série (Bo1→1, Bo3→2, Bo5→3). */
export function seriesWinsNeeded(bestOf) {
  if (!SERIES_BEST_OF.includes(bestOf))
    throw Error("Formato de série inválido (use 1, 3 ou 5).");
  return Math.ceil(bestOf / 2);
}

/**
 * Regras imutáveis por partida.
 * - seriesBestOf: 1|3|5 (melhor de N; liquidação só ao fechar a série).
 * - rageQuit: 'loss' → desconexão sem reconexão após RUNNING concede vitória
 *   da série ao oponente ainda conectado; 'review' → abre revisão.
 *   Ambos desconectados ou evidência ambígua sempre abrem revisão.
 */
export function makeRules({
  durationMs = 1200000,
  reviewMs = 86400000,
  hosted = false,
  seriesBestOf = 1,
  rageQuit = "loss",
} = {}) {
  if (
    ![durationMs, reviewMs].every(
      (n) => Number.isSafeInteger(n) && n >= 50 && n <= 604800000,
    )
  )
    throw Error("Prazo de partida/revisão inválido.");
  if (!SERIES_BEST_OF.includes(seriesBestOf))
    throw Error("Formato de série inválido (use 1, 3 ou 5).");
  if (!["loss", "review"].includes(rageQuit))
    throw Error("Política de rage-quit inválida.");
  return Object.freeze({
    version: 1,
    protocol: 2,
    game: "kof2002-original",
    transport: hosted ? "server-stream" : "host-stream",
    authority: hosted ? "server-session" : "untrusted-player-host",
    resultMode: hosted ? "server-observer" : "demo-dual-confirmation",
    durationMs,
    reviewMs,
    seriesBestOf,
    seriesWinsNeeded: seriesWinsNeeded(seriesBestOf),
    rageQuit,
    // Ficha (2) permitida: Neo Geo precisa de CREDIT; Y/FICHA no cliente + seed no host.
    allowedButtons,
    cancellation: "refund-before-running-review-after-running",
    reviewTimeout: "refund-without-verdict",
    disconnectAfterRunning:
      rageQuit === "loss"
        ? "opponent-series-win-if-peer-online-else-review"
        : "open-review",
  });
}

export const appendEvent = db.transaction(
  (matchId, actor, kind, detail = {}) => {
    const last = db
      .prepare(
        "SELECT seq,hash FROM match_events WHERE match_id=? ORDER BY seq DESC LIMIT 1",
      )
      .get(matchId);
    const seq = (last?.seq || 0) + 1,
      at = Date.now(),
      payload = JSON.stringify(detail),
      previous = last?.hash || "";
    const hash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify([matchId, seq, at, actor, kind, payload, previous]),
      )
      .digest("hex");
    db.prepare("INSERT INTO match_events VALUES(?,?,?,?,?,?,?,?)").run(
      matchId,
      seq,
      at,
      actor,
      kind,
      payload,
      previous,
      hash,
    );
    return { seq, hash };
  },
);
export const saveRules = db.transaction((matchId, rules) => {
  db.prepare("INSERT INTO match_rules VALUES(?,?)").run(
    matchId,
    JSON.stringify(rules),
  );
  appendEvent(matchId, "SYSTEM", "CREATED", { rules });
});

const transitions = {
  QUEUED: ["LOADING", "ENDED"],
  LOADING: ["RUNNING", "ENDED"],
  RUNNING: ["AWAITING_RESULT", "REVIEW", "ENDED"],
  AWAITING_RESULT: ["REVIEW", "ENDED"],
  REVIEW: ["ENDED"],
};
export const transition = db.transaction((m, next) => {
  if (!transitions[m.phase]?.includes(next))
    throw Error("Transição de partida inválida.");
  appendEvent(m.id, "SYSTEM", "PHASE", { from: m.phase, to: next });
  db.prepare(
    "UPDATE match_state SET phase=?,updated_at=datetime('now') WHERE match_id=?",
  ).run(next, m.id);
});

// Connection-bound epochs prevent replay across reconnects. The session owns its
// controller port; any slot supplied in a message is rejected by the caller.
export function acceptInput(stream, input) {
  if (
    input.epoch !== stream.epoch ||
    !Number.isSafeInteger(input.seq) ||
    input.seq !== stream.seq + 1
  )
    throw Error("Sequência de controle inválida; reconecte a sessão.");
  // Consume the sequence even when the content is rejected, so the next valid
  // message is not permanently blocked after an invalid key combination.
  stream.seq = input.seq;
  if (!allowedButtons.includes(input.button) || ![0, 1].includes(input.value))
    throw Error("Botão ou valor de controle inválido.");
  if (stream.pressed.has(input.button) === Boolean(input.value))
    throw Error("Estado de controle repetido.");
  const opposite = { 4: 5, 5: 4, 6: 7, 7: 6 };
  if (input.value && stream.pressed.has(opposite[input.button]))
    throw Error("Direções opostas simultâneas não são permitidas.");
  if (input.value) stream.pressed.add(input.button);
  else stream.pressed.delete(input.button);
  return { button: input.button, value: input.value, seq: input.seq };
}

export const openReview = db.transaction((m, actor, reason, evidence = null) => {
  const now = Date.now(),
    deadlineAt = now + m.rules.reviewMs;
  const evidenceJson =
    evidence == null
      ? null
      : typeof evidence === "string"
        ? evidence
        : JSON.stringify(evidence);
  const result = db
    .prepare(
      "INSERT OR IGNORE INTO match_reviews(match_id,reason,opened_by,opened_at,deadline_at,evidence) VALUES(?,?,?,?,?,?)",
    )
    .run(m.id, reason, actor, now, deadlineAt, evidenceJson);
  if (!result.changes) {
    if (evidenceJson) {
      db.prepare(
        "UPDATE match_reviews SET evidence=COALESCE(evidence, ?) WHERE match_id=? AND status='OPEN'",
      ).run(evidenceJson, m.id);
    }
    return db
      .prepare(
        "SELECT deadline_at deadlineAt FROM match_reviews WHERE match_id=?",
      )
      .get(m.id);
  }
  // Trava liquidação automática: settleMatch só aceita DISPUTE via fromReview.
  db.prepare(
    "UPDATE matches SET status='DISPUTE',dispute=1 WHERE id=? AND status='IN_PROGRESS'",
  ).run(m.id);
  transition(m, "REVIEW");
  appendEvent(m.id, actor, "REVIEW_OPENED", {
    reason,
    deadlineAt,
    evidence: evidence
      ? {
          kind: evidence.kind,
          relativePath: evidence.relativePath,
          at: evidence.at,
          sample: evidence.sample || null,
        }
      : null,
  });
  return { deadlineAt };
});

export const resolveReview = db.transaction(
  (matchId, actor, decision, reason) => {
    if (!["REFUND", "PLAYER_A", "PLAYER_B"].includes(decision))
      throw Error("Decisão inválida.");
    if (
      typeof reason !== "string" ||
      reason.trim().length < 20 ||
      reason.length > 1000
    )
      throw Error(
        "Informe justificativa e referência às evidências (20 a 1000 caracteres).",
      );
    const review = db
      .prepare("SELECT * FROM match_reviews WHERE match_id=?")
      .get(matchId);
    if (!review) throw Error("Revisão não encontrada.");
    if (review.status !== "OPEN") {
      if (review.decision !== decision)
        throw Error("Revisão já encerrada com outra decisão.");
      return { repeated: true };
    }
    if (decision !== "REFUND" && Date.now() >= review.deadline_at)
      throw Error("Prazo de revisão encerrado; somente estorno permitido.");
    const match = db.prepare("SELECT * FROM matches WHERE id=?").get(matchId);
    if (decision === "REFUND") finance.cancelMatch(matchId, reason, true);
    else
      finance.settleMatch(
        matchId,
        decision === "PLAYER_A" ? match.player_a_id : match.player_b_id,
        { fromReview: true },
      );
    db.prepare(
      "UPDATE match_reviews SET status='CLOSED',decision=?,decision_reason=?,decided_by=?,decided_at=? WHERE match_id=?",
    ).run(decision, reason.trim(), actor, Date.now(), matchId);
    appendEvent(matchId, actor, "REVIEW_CLOSED", {
      decision,
      reason: reason.trim(),
    });
    return { repeated: false, match };
  },
);
export function expireReviews() {
  const rows = db
    .prepare(
      "SELECT match_id FROM match_reviews WHERE status='OPEN' AND deadline_at<=?",
    )
    .all(Date.now());
  return rows.map((row) =>
    resolveReview(
      row.match_id,
      "SYSTEM",
      "REFUND",
      "Prazo de revisão esgotado sem decisão. Estorno sem atribuição de vitória.",
    ),
  );
}
