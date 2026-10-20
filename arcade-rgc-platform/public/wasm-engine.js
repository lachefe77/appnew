/**
 * ARENA ARCADE — Netplay Bridge (Rollback Netcode)
 * Conecta game-engine.js ao WebSocket server.
 * Implementa predição de input, rollback em desync e relay de frames.
 *
 * Protocolo WS usado:
 *   NETPLAY_FRAME  { frameNumber, inputMask, stateHash }   → envia input local ao server
 *   REMOTE_INPUT   { frameNumber, inputMask, stateHash }   ← recebe input do oponente
 *   FORCE_RESYNC   { frameNumber, p1State, p2State }       ← server força resync
 */

import { KOFGame, GameRenderer, INP, STAGE_W, STAGE_H, FPS } from './game-engine.js';

// ─── Constants ───────────────────────────────────────────────────────────────
const ROLLBACK_FRAMES = 16; // max frames we can roll back
const SEND_INTERVAL   = 1;  // send input every N frames (1 = every frame, ideal for fighting)
const PING_INTERVAL_MS = 2000;

// ─── NetplayEngine ───────────────────────────────────────────────────────────
export class NetplayEngine {
  constructor(canvas, ws, localPlayerSlot) {
    this.canvas     = canvas;
    this.ws         = ws;
    this.localSlot  = localPlayerSlot; // 1 or 2
    this.game       = new KOFGame();
    this.renderer   = new GameRenderer(canvas);

    this.frameNumber   = 0;
    this.running       = false;
    this.rafHandle     = null;
    this.lastFrameTime = 0;
    this.accTime       = 0;
    const frameDt      = 1000 / FPS;

    // Input state
    this.localInput  = 0; // current frame bitmask
    this.remoteInput = 0; // last confirmed remote input

    // Rollback buffers — circular, ROLLBACK_FRAMES deep
    this.snapshots    = new Array(ROLLBACK_FRAMES);  // game snapshots
    this.localInputs  = new Array(ROLLBACK_FRAMES).fill(0);
    this.remoteInputs = new Array(ROLLBACK_FRAMES).fill(0);
    this.confirmedUpTo = -1; // last frame where remote input is confirmed

    // Keyboard state
    this._keysDown = new Set();
    this._setupKeyboard();

    // WS message handler
    this._boundMsgHandler = this._onWsMessage.bind(this);
    ws.addEventListener('message', this._boundMsgHandler);

    // Ping tracking
    this._pingsSent = new Map(); // pingId -> sentAt
    this._latencyMs = 0;
    this._pingTimer = null;

    this._frameDt = frameDt;
    this._matchId = null;
  }

  // ─── Start/Stop ────────────────────────────────────────────────────────────
  start(matchId) {
    if (this.running) return;
    this._matchId = matchId;
    this.running  = true;
    this.lastFrameTime = performance.now();
    this._pingTimer = setInterval(() => this._sendPing(), PING_INTERVAL_MS);
    this._loop(performance.now());
  }

  stop() {
    this.running = false;
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    if (this._pingTimer) clearInterval(this._pingTimer);
    this.ws.removeEventListener('message', this._boundMsgHandler);
    this._teardownKeyboard();
  }

  // ─── Main loop ─────────────────────────────────────────────────────────────
  _loop(now) {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(t => this._loop(t));

    this.accTime += now - this.lastFrameTime;
    this.lastFrameTime = now;

    // Process at most 2 frames per rAF to avoid spiral of death
    let stepped = 0;
    while (this.accTime >= this._frameDt && stepped < 2) {
      this._stepFrame();
      this.accTime -= this._frameDt;
      stepped++;
    }

    this.renderer.draw(this.game);
    this._drawNetInfo();

    // Match ended
    if (this.game.phase === 'MATCH_END' && this.running) {
      this._onMatchEnd();
    }
  }

  _stepFrame() {
    const f = this.frameNumber;
    const idx = f % ROLLBACK_FRAMES;

    // Sample local input
    this.localInput = this._sampleInput();
    this.localInputs[idx] = this.localInput;

    // Snapshot before we simulate (needed for rollback)
    this.snapshots[idx] = this.game.snapshot();

    // Predict remote input (use last known if not confirmed)
    const predictedRemote = this.remoteInputs[(f - 1 + ROLLBACK_FRAMES) % ROLLBACK_FRAMES];
    this.remoteInputs[idx] = this.confirmedUpTo >= f
      ? this.remoteInputs[idx]   // already received — use it
      : predictedRemote;         // prediction

    // Route p1/p2 inputs
    const [inp1, inp2] = this.localSlot === 1
      ? [this.localInput, this.remoteInputs[idx]]
      : [this.remoteInputs[idx], this.localInput];

    this.game.update(inp1, inp2);

    // Send our input to server
    if (f % SEND_INTERVAL === 0) {
      this._sendFrame(f, this.localInput, this.game.getStateHash());
    }

    this.frameNumber++;
  }

  // ─── Rollback ──────────────────────────────────────────────────────────────
  _rollbackTo(targetFrame) {
    const idx = targetFrame % ROLLBACK_FRAMES;
    const snap = this.snapshots[idx];
    if (!snap) return; // snapshot expired — too far back

    // Restore state at targetFrame
    this.game.restore(snap);
    const rollbackEnd = this.frameNumber;

    // Re-simulate from targetFrame to current frame with corrected inputs
    for (let rf = targetFrame; rf < rollbackEnd; rf++) {
      const ri = rf % ROLLBACK_FRAMES;
      const [inp1, inp2] = this.localSlot === 1
        ? [this.localInputs[ri], this.remoteInputs[ri]]
        : [this.remoteInputs[ri], this.localInputs[ri]];
      this.game.update(inp1, inp2);
    }
  }

  // ─── WebSocket ─────────────────────────────────────────────────────────────
  _sendFrame(frameNumber, inputMask, stateHash) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'NETPLAY_FRAME',
      matchId: this._matchId,
      frameNumber,
      inputMask,
      stateHash
    }));
  }

  _sendPing() {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const pingId = Math.random().toString(36).slice(2);
    this._pingsSent.set(pingId, performance.now());
    this.ws.send(JSON.stringify({ type: 'PING', pingId }));
  }

  _onWsMessage(event) {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }

    switch (data.type) {
      case 'REMOTE_INPUT':
        this._handleRemoteInput(data);
        break;

      case 'FORCE_RESYNC':
        this._handleForceResync(data);
        break;

      case 'PONG':
        if (data.pingId && this._pingsSent.has(data.pingId)) {
          this._latencyMs = Math.round(performance.now() - this._pingsSent.get(data.pingId));
          this._pingsSent.delete(data.pingId);
        }
        break;

      case 'MATCH_ENDED':
        // Server confirmed match end
        this.stop();
        break;
    }
  }

  _handleRemoteInput(data) {
    const { frameNumber, inputMask, stateHash } = data;
    const idx = frameNumber % ROLLBACK_FRAMES;

    // Only accept inputs within rollback window
    if (frameNumber < this.frameNumber - ROLLBACK_FRAMES) return;

    const prevRemote = this.remoteInputs[idx];
    this.remoteInputs[idx] = inputMask;
    if (frameNumber > this.confirmedUpTo) this.confirmedUpTo = frameNumber;

    // If the input differs from our prediction and the frame is in the past, rollback
    if (frameNumber < this.frameNumber && prevRemote !== inputMask) {
      this._rollbackTo(frameNumber);
    }

    // Verify state hash if the frame is current
    if (frameNumber === this.frameNumber - 1 && stateHash) {
      const ourHash = this.game.getStateHash();
      if (ourHash !== stateHash) {
        // Desync detected — report to server
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'DESYNC_REPORT',
            matchId: this._matchId,
            frameNumber,
            localHash: ourHash,
            remoteHash: stateHash
          }));
        }
      }
    }
  }

  _handleForceResync(data) {
    // Server pushes authoritative state
    const { frameNumber, p1State, p2State } = data;
    if (!p1State || !p2State) return;

    // Build a synthetic snapshot from authoritative state
    const authSnap = this.game.snapshot();
    Object.assign(authSnap.p1, p1State);
    Object.assign(authSnap.p2, p2State);
    this.game.restore(authSnap);
    this.frameNumber = frameNumber;

    // Clear stale rollback buffers
    for (let i = 0; i < ROLLBACK_FRAMES; i++) {
      this.snapshots[i]    = null;
      this.localInputs[i]  = 0;
      this.remoteInputs[i] = 0;
    }
    this.confirmedUpTo = frameNumber - 1;
  }

  _onMatchEnd() {
    // Report result to server
    const winnerId = this.game.winnerId; // 1 or 2
    if (!winnerId || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'REPORT_MATCH_RESULT',
      matchId: this._matchId,
      winnerId: winnerId === this.localSlot
        ? window.__arenaApp?.myId
        : window.__arenaApp?.opponentId
    }));
    this.running = false;
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
  }

  // ─── Input sampling ────────────────────────────────────────────────────────
  _sampleInput() {
    let mask = 0;
    const k = this._keysDown;
    if (this.localSlot === 1) {
      if (k.has('w') || k.has('arrowup'))    mask |= INP.UP;
      if (k.has('s') || k.has('arrowdown'))  mask |= INP.DOWN;
      if (k.has('a') || k.has('arrowleft'))  mask |= INP.LEFT;
      if (k.has('d') || k.has('arrowright')) mask |= INP.RIGHT;
      if (k.has('u') || k.has('j'))          mask |= INP.A;
      if (k.has('i') || k.has('k'))          mask |= INP.B;
      if (k.has('o') || k.has('l'))          mask |= INP.C;
      if (k.has('p') || k.has(';'))          mask |= INP.D;
    } else {
      // P2 (same keys, since P2 inputs come from remote — local only matters in local mode)
      if (k.has('arrowup'))    mask |= INP.UP;
      if (k.has('arrowdown'))  mask |= INP.DOWN;
      if (k.has('arrowleft'))  mask |= INP.LEFT;
      if (k.has('arrowright')) mask |= INP.RIGHT;
      if (k.has('1'))          mask |= INP.A;
      if (k.has('2'))          mask |= INP.B;
      if (k.has('3'))          mask |= INP.C;
      if (k.has('4'))          mask |= INP.D;
    }
    return mask;
  }

  _setupKeyboard() {
    this._onKeyDown = e => {
      this._keysDown.add(e.key.toLowerCase());
      // Prevent scroll on arrow keys during game
      if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    };
    this._onKeyUp = e => this._keysDown.delete(e.key.toLowerCase());
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup',   this._onKeyUp);
  }

  _teardownKeyboard() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup',   this._onKeyUp);
  }

  // ─── HUD overlay (ping, frame) ─────────────────────────────────────────────
  _drawNetInfo() {
    const ctx = this.renderer.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(STAGE_W - 130, STAGE_H - 36, 128, 32);
    ctx.fillStyle = this._latencyMs < 60 ? '#00ff88' : this._latencyMs < 120 ? '#ffcc00' : '#ff4444';
    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.fillText(`PING ${this._latencyMs}ms  F${this.frameNumber}`, STAGE_W - 126, STAGE_H - 16);
    ctx.restore();
  }
}

// ─── Local Practice Mode (no network) ────────────────────────────────────────
export class LocalGameEngine {
  constructor(canvas) {
    this.canvas   = canvas;
    this.game     = new KOFGame();
    this.renderer = new GameRenderer(canvas);
    this.running  = false;
    this._keysDown = new Set();
    this._rafHandle = null;
    this._lastTime  = 0;
    this._accTime   = 0;
    this._frameDt   = 1000 / FPS;
  }

  start() {
    if (this.running) return;
    this.running  = true;
    this._lastTime = performance.now();
    this._setupKeyboard();
    this._loop(performance.now());
  }

  stop() {
    this.running = false;
    if (this._rafHandle) cancelAnimationFrame(this._rafHandle);
    this._teardownKeyboard();
  }

  _loop(now) {
    if (!this.running) return;
    this._rafHandle = requestAnimationFrame(t => this._loop(t));
    this._accTime += now - this._lastTime;
    this._lastTime = now;
    let stepped = 0;
    while (this._accTime >= this._frameDt && stepped < 2) {
      this.game.update(this._sampleP1(), this._sampleP2());
      this._accTime -= this._frameDt;
      stepped++;
    }
    this.renderer.draw(this.game);
  }

  _sampleP1() {
    let mask = 0;
    const k = this._keysDown;
    if (k.has('w')) mask |= INP.UP;
    if (k.has('s')) mask |= INP.DOWN;
    if (k.has('a')) mask |= INP.LEFT;
    if (k.has('d')) mask |= INP.RIGHT;
    if (k.has('u')) mask |= INP.A;
    if (k.has('i')) mask |= INP.B;
    if (k.has('o')) mask |= INP.C;
    if (k.has('p')) mask |= INP.D;
    return mask;
  }

  _sampleP2() {
    let mask = 0;
    const k = this._keysDown;
    if (k.has('arrowup'))    mask |= INP.UP;
    if (k.has('arrowdown'))  mask |= INP.DOWN;
    if (k.has('arrowleft'))  mask |= INP.LEFT;
    if (k.has('arrowright')) mask |= INP.RIGHT;
    if (k.has('1'))          mask |= INP.A;
    if (k.has('2'))          mask |= INP.B;
    if (k.has('3'))          mask |= INP.C;
    if (k.has('4'))          mask |= INP.D;
    return mask;
  }

  _setupKeyboard() {
    this._onKeyDown = e => {
      this._keysDown.add(e.key.toLowerCase());
      if (['arrowup','arrowdown','arrowleft','arrowright'].includes(e.key.toLowerCase())) e.preventDefault();
    };
    this._onKeyUp = e => this._keysDown.delete(e.key.toLowerCase());
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup',   this._onKeyUp);
  }

  _teardownKeyboard() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup',   this._onKeyUp);
  }
}

// ─── Global export para index.html ───────────────────────────────────────────
window.NetplayEngine  = NetplayEngine;
window.LocalGameEngine = LocalGameEngine;
