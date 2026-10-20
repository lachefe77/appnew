/**
 * ARENA ARCADE — Motor de Jogo 2D Fighter (Determinístico)
 * Implementa física, hitboxes, round system e hash de estado para netplay rollback.
 * Compatível com FBNeo WASM quando disponível (substitui drawFrame).
 */

// ─── Constantes ───────────────────────────────────────────────────────────────
export const STAGE_W     = 800;
export const STAGE_H     = 450;
export const FLOOR_Y     = 370;
export const GRAVITY     = 0.75;
export const WALK_SPEED  = 4;
export const JUMP_VY     = -16;
export const MAX_HP      = 1000;
export const ROUND_TIME  = 99; // segundos
export const FPS         = 60;

// Input bitmasks (8-bit)
export const INP = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, A: 16, B: 32, C: 64, D: 128 };

// Character configs
const CHAR_CONFIG = {
  Iori: { color: '#cc00ff', accentColor: '#ff0055', hitColor: '#ff99cc', projectileColor: '#cc00ff' },
  Kyo:  { color: '#ff8800', accentColor: '#ffdd00', hitColor: '#ffcc66', projectileColor: '#ff8800' }
};

// ─── Attack data ──────────────────────────────────────────────────────────────
const ATTACKS = {
  A: { damage: 60,  stun: 8,  hitstop: 4, startup: 4,  active: 3, recovery: 8,  hitboxW: 55,  hitboxH: 40, yOffset: -50 },
  B: { damage: 80,  stun: 10, hitstop: 5, startup: 5,  active: 3, recovery: 10, hitboxW: 65,  hitboxH: 55, yOffset: -70 },
  C: { damage: 130, stun: 15, hitstop: 7, startup: 8,  active: 4, recovery: 16, hitboxW: 70,  hitboxH: 50, yOffset: -55 },
  D: { damage: 120, stun: 14, hitstop: 6, startup: 7,  active: 4, recovery: 18, hitboxW: 75,  hitboxH: 80, yOffset: -75 },
  // QCF+A fireball (triggered by special move input)
  FIREBALL: { damage: 100, stun: 20, hitstop: 0, startup: 12, active: 60, recovery: 20, hitboxW: 30, hitboxH: 30, yOffset: -60, isProjectile: true, speed: 6 }
};

// ─── Fighter class ────────────────────────────────────────────────────────────
class Fighter {
  constructor(name, x, facing) {
    this.name = name;
    this.config = CHAR_CONFIG[name] || CHAR_CONFIG.Iori;
    this.reset(x, facing);
  }

  reset(x, facing) {
    this.x        = x;
    this.y        = FLOOR_Y;
    this.vx       = 0;
    this.vy       = 0;
    this.hp       = MAX_HP;
    this.facing   = facing; // 1 = right, -1 = left
    this.state    = 'IDLE'; // IDLE, WALK_FWD, WALK_BWD, JUMP, CROUCH, ATTACK_A/B/C/D, HIT, KO
    this.stateFrame = 0;
    this.attackData = null;
    this.hitActive  = false;  // hitbox live
    this.hasHit     = false;  // already landed this swing
    this.hitstopFrames = 0;
    this.onGround   = true;
    this.roundWins  = 0;
    this.projectile = null;   // { x, y, vx, hitboxW, hitboxH, damage, stun, active, hasHit, ownerId }
    // QCF motion buffer: last 10 inputs to detect quarter-circle
    this.inputBuffer = [];
    this.specialCooldown = 0;
  }

  get w() { return 48; }
  get h() { return 90; }

  get pushboxL() { return this.x - this.w / 2; }
  get pushboxR() { return this.x + this.w / 2; }
  get pushboxT() { return this.y - this.h; }
  get pushboxB() { return this.y; }

  // Hurt box (slightly smaller than push box)
  get hurtboxL() { return this.x - 22; }
  get hurtboxR() { return this.x + 22; }
  get hurtboxT() { return this.y - this.h + 5; }
  get hurtboxB() { return this.y - 5; }

  // Hitbox when attacking
  getHitbox() {
    if (!this.hitActive || !this.attackData) return null;
    const ad = this.attackData;
    const hx = this.facing === 1 ? this.x + 10 : this.x - 10 - ad.hitboxW;
    const hy = this.y + ad.yOffset;
    return { x: hx, y: hy, w: ad.hitboxW, h: ad.hitboxH };
  }

  serialize() {
    return {
      x: Math.round(this.x), y: Math.round(this.y),
      vx: Math.round(this.vx * 100), vy: Math.round(this.vy * 100),
      hp: this.hp, facing: this.facing, state: this.state,
      stateFrame: this.stateFrame, roundWins: this.roundWins,
      proj: this.projectile ? Math.round(this.projectile.x) : -1
    };
  }
}

// ─── Game state ───────────────────────────────────────────────────────────────
export class KOFGame {
  constructor() {
    this.p1 = new Fighter('Iori', 220, 1);
    this.p2 = new Fighter('Kyo',  580, -1);
    this.round       = 1;
    this.maxRounds   = 3; // FT2
    this.timerFrames = ROUND_TIME * FPS;
    this.phase       = 'ROUND_START'; // ROUND_START | FIGHT | ROUND_END | MATCH_END
    this.phaseFrames = 0;
    this.winnerId    = null; // 1 or 2
    this.lastP1Input = 0;
    this.lastP2Input = 0;
  }

  // ─── Update one frame ───────────────────────────────────────────────────────
  update(p1Input, p2Input) {
    this.lastP1Input = p1Input;
    this.lastP2Input = p2Input;

    switch (this.phase) {
      case 'ROUND_START':
        this.phaseFrames++;
        if (this.phaseFrames >= 90) { // 1.5s intro
          this.phase = 'FIGHT';
          this.phaseFrames = 0;
        }
        return;

      case 'FIGHT':
        this._updateFight(p1Input, p2Input);
        return;

      case 'ROUND_END':
        this.phaseFrames++;
        if (this.phaseFrames >= 120) this._nextRoundOrMatch();
        return;

      case 'MATCH_END':
        return;
    }
  }

  _updateFight(p1Input, p2Input) {
    this.timerFrames = Math.max(0, this.timerFrames - 1);

    // Update hitstop
    if (this.p1.hitstopFrames > 0) { this.p1.hitstopFrames--; return; }
    if (this.p2.hitstopFrames > 0) { this.p2.hitstopFrames--; return; }

    // Update facing (always face opponent, unless attacking/hit)
    if (!['ATTACK_A','ATTACK_B','ATTACK_C','ATTACK_D','HIT','KO'].includes(this.p1.state)) {
      this.p1.facing = this.p2.x > this.p1.x ? 1 : -1;
    }
    if (!['ATTACK_A','ATTACK_B','ATTACK_C','ATTACK_D','HIT','KO'].includes(this.p2.state)) {
      this.p2.facing = this.p1.x > this.p2.x ? 1 : -1;
    }

    this._updateFighter(this.p1, p1Input, this.p2);
    this._updateFighter(this.p2, p2Input, this.p1);
    this._resolveCollisions();
    this._resolveHits();
    this._updateProjectiles();

    // Check round end conditions
    if (this.p1.hp <= 0 || this.p2.hp <= 0 || this.timerFrames === 0) {
      this._endRound();
    }
  }

  _updateFighter(f, input, opponent) {
    if (f.specialCooldown > 0) f.specialCooldown--;

    // Update input buffer (for special move detection)
    f.inputBuffer.push(input);
    if (f.inputBuffer.length > 12) f.inputBuffer.shift();

    switch (f.state) {
      case 'IDLE':
      case 'WALK_FWD':
      case 'WALK_BWD':
        this._handleGroundInput(f, input);
        break;

      case 'JUMP':
        this._handleAirInput(f, input);
        f.y += f.vy;
        f.vy += GRAVITY;
        if (f.y >= FLOOR_Y) {
          f.y = FLOOR_Y; f.vy = 0; f.vx = 0;
          f.onGround = true;
          f.state = 'IDLE'; f.stateFrame = 0;
          f.hitActive = false; f.hasHit = false;
        }
        break;

      case 'CROUCH':
        if (!(input & INP.DOWN)) { f.state = 'IDLE'; f.stateFrame = 0; }
        if (this._checkAttackInput(f, input)) break;
        break;

      case 'ATTACK_A':
      case 'ATTACK_B':
      case 'ATTACK_C':
      case 'ATTACK_D': {
        const ad = f.attackData;
        f.stateFrame++;
        f.hitActive = (f.stateFrame > ad.startup && f.stateFrame <= ad.startup + ad.active);
        if (f.stateFrame > ad.startup + ad.active + ad.recovery) {
          f.state = f.onGround ? 'IDLE' : 'JUMP';
          f.stateFrame = 0; f.hitActive = false; f.hasHit = false; f.attackData = null;
        }
        break;
      }

      case 'HIT':
        f.stateFrame++;
        if (f.stateFrame > (f._stunFrames || 12)) {
          f.state = f.onGround ? 'IDLE' : 'JUMP';
          f.stateFrame = 0;
        }
        break;

      case 'KO':
        break;
    }

    // Apply horizontal movement
    if (f.state === 'WALK_FWD')  f.x += f.vx;
    if (f.state === 'WALK_BWD')  f.x -= Math.abs(f.vx);

    // Stage bounds
    f.x = Math.max(50, Math.min(STAGE_W - 50, f.x));
  }

  _handleGroundInput(f, input) {
    const movingFwd  = (f.facing === 1 && (input & INP.RIGHT)) || (f.facing === -1 && (input & INP.LEFT));
    const movingBwd  = (f.facing === 1 && (input & INP.LEFT))  || (f.facing === -1 && (input & INP.RIGHT));
    const crouching  = !!(input & INP.DOWN);
    const jumping    = !!(input & INP.UP);

    if (this._checkAttackInput(f, input)) return;
    if (this._checkSpecialInput(f, input)) return;

    if (jumping) {
      f.state = 'JUMP'; f.vy = JUMP_VY;
      f.vx = movingFwd ? WALK_SPEED : (movingBwd ? -WALK_SPEED * 0.6 : 0);
      f.onGround = false; f.stateFrame = 0; return;
    }
    if (crouching) { f.state = 'CROUCH'; f.vx = 0; f.stateFrame = 0; return; }
    if (movingFwd) { f.state = 'WALK_FWD'; f.vx = WALK_SPEED; return; }
    if (movingBwd) { f.state = 'WALK_BWD'; f.vx = WALK_SPEED; return; }
    f.state = 'IDLE'; f.vx = 0;
  }

  _handleAirInput(f, input) {
    if (this._checkAttackInput(f, input)) return;
    // Allow air movement
    const movingFwd = (f.facing === 1 && (input & INP.RIGHT)) || (f.facing === -1 && (input & INP.LEFT));
    const movingBwd = (f.facing === 1 && (input & INP.LEFT))  || (f.facing === -1 && (input & INP.RIGHT));
    if (movingFwd) f.vx = Math.min(f.vx + 0.5, WALK_SPEED);
    if (movingBwd) f.vx = Math.max(f.vx - 0.5, -WALK_SPEED);
  }

  _checkAttackInput(f, input) {
    if (f.state.startsWith('ATTACK')) return false; // already attacking
    const attackMap = { [INP.A]: 'A', [INP.B]: 'B', [INP.C]: 'C', [INP.D]: 'D' };
    for (const [btn, name] of Object.entries(attackMap)) {
      if (input & parseInt(btn)) {
        f.state = 'ATTACK_' + name;
        f.stateFrame = 0;
        f.attackData = ATTACKS[name];
        f.hitActive = false;
        f.hasHit = false;
        return true;
      }
    }
    return false;
  }

  _checkSpecialInput(f, input) {
    if (f.specialCooldown > 0) return false;
    // QCF+A: detect DOWN, DOWN-RIGHT, RIGHT + A in buffer
    const buf = f.inputBuffer;
    if (buf.length >= 4 && (input & INP.A)) {
      const hasDown     = buf.slice(-4).some(i => (i & INP.DOWN) && !(i & INP.RIGHT));
      const hasDownFwd  = buf.slice(-4).some(i => (i & INP.DOWN) && (i & INP.RIGHT));
      const hasFwd      = buf.slice(-4).some(i => !(i & INP.DOWN) && (i & INP.RIGHT));
      if (hasDown && hasDownFwd && hasFwd) {
        this._launchFireball(f);
        f.specialCooldown = 40;
        return true;
      }
    }
    return false;
  }

  _launchFireball(f) {
    const ad = ATTACKS.FIREBALL;
    f.projectile = {
      x: f.x + (f.facing === 1 ? 40 : -40),
      y: f.y - 65,
      vx: ad.speed * f.facing,
      hitboxW: ad.hitboxW,
      hitboxH: ad.hitboxH,
      damage: ad.damage,
      stun: ad.stun,
      active: ad.active,
      hasHit: false,
      ownerId: f === this.p1 ? 1 : 2,
      color: f.config.projectileColor
    };
  }

  _updateProjectiles() {
    [this.p1, this.p2].forEach(f => {
      if (!f.projectile) return;
      const proj = f.projectile;
      proj.x += proj.vx;
      proj.active--;
      if (proj.active <= 0 || proj.x < 0 || proj.x > STAGE_W) { f.projectile = null; return; }

      // Check hit vs opponent
      const opp = f === this.p1 ? this.p2 : this.p1;
      if (!proj.hasHit && this._rectOverlap(
        proj.x - proj.hitboxW / 2, proj.y - proj.hitboxH / 2, proj.hitboxW, proj.hitboxH,
        opp.hurtboxL, opp.hurtboxT, opp.hurtboxR - opp.hurtboxL, opp.hurtboxB - opp.hurtboxT
      )) {
        this._applyHit(opp, proj.damage, proj.stun);
        proj.hasHit = true;
        f.projectile = null;
      }
    });
  }

  _resolveCollisions() {
    const pushDist = (this.p1.w + this.p2.w) / 2;
    const dx = this.p2.x - this.p1.x;
    if (Math.abs(dx) < pushDist) {
      const overlap = pushDist - Math.abs(dx);
      const dir = dx > 0 ? 1 : -1;
      this.p1.x -= (overlap / 2) * dir;
      this.p2.x += (overlap / 2) * dir;
      this.p1.x = Math.max(50, Math.min(STAGE_W - 50, this.p1.x));
      this.p2.x = Math.max(50, Math.min(STAGE_W - 50, this.p2.x));
    }
  }

  _resolveHits() {
    const pairs = [
      { attacker: this.p1, defender: this.p2 },
      { attacker: this.p2, defender: this.p1 }
    ];
    for (const { attacker, defender } of pairs) {
      if (!attacker.hitActive || attacker.hasHit) continue;
      if (defender.state === 'KO') continue;
      const hb = attacker.getHitbox();
      if (!hb) continue;
      if (this._rectOverlap(
        hb.x, hb.y, hb.w, hb.h,
        defender.hurtboxL, defender.hurtboxT,
        defender.hurtboxR - defender.hurtboxL, defender.hurtboxB - defender.hurtboxT
      )) {
        this._applyHit(defender, attacker.attackData.damage, attacker.attackData.stun);
        attacker.hasHit = true;
        attacker.hitstopFrames = attacker.attackData.hitstop;
        defender.hitstopFrames = attacker.attackData.hitstop;
      }
    }
  }

  _applyHit(defender, damage, stunFrames) {
    defender.hp = Math.max(0, defender.hp - damage);
    if (defender.hp <= 0) {
      defender.state = 'KO';
      window.ArcadeAudio && window.ArcadeAudio.play('KO');
    } else {
      defender.state = 'HIT';
      defender._stunFrames = stunFrames;
      defender.stateFrame = 0;
      window.ArcadeAudio && window.ArcadeAudio.play('HIT');
    }
    // Knockback
    const pushDir = defender.x > (defender === this.p1 ? this.p2.x : this.p1.x) ? 1 : -1;
    defender.x += pushDir * 8;
  }

  _rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  _endRound() {
    this.phase = 'ROUND_END';
    this.phaseFrames = 0;

    let roundWinner;
    if (this.p1.hp <= 0 && this.p2.hp > 0) roundWinner = 2;
    else if (this.p2.hp <= 0 && this.p1.hp > 0) roundWinner = 1;
    else if (this.timerFrames === 0) {
      roundWinner = this.p1.hp >= this.p2.hp ? 1 : 2;
    } else {
      roundWinner = this.p1.hp >= this.p2.hp ? 1 : 2;
    }

    if (roundWinner === 1) this.p1.roundWins++;
    else this.p2.roundWins++;
  }

  _nextRoundOrMatch() {
    const winsNeeded = Math.ceil(this.maxRounds / 2);
    if (this.p1.roundWins >= winsNeeded) {
      this.phase = 'MATCH_END'; this.winnerId = 1;
      window.ArcadeAudio && window.ArcadeAudio.play('VICTORY');
    } else if (this.p2.roundWins >= winsNeeded) {
      this.phase = 'MATCH_END'; this.winnerId = 2;
      window.ArcadeAudio && window.ArcadeAudio.play('VICTORY');
    } else {
      this.round++;
      this.timerFrames = ROUND_TIME * FPS;
      this.p1.reset(220, 1);
      this.p2.reset(580, -1);
      this.p1.roundWins = this.p1.roundWins; // preserve
      this.p2.roundWins = this.p2.roundWins;
      this.phase = 'ROUND_START'; this.phaseFrames = 0;
    }
  }

  // ─── Deterministic state hash for sync verification ─────────────────────────
  getStateHash() {
    const s1 = this.p1.serialize();
    const s2 = this.p2.serialize();
    let h = 0;
    const nums = [
      s1.x, s1.y, s1.vx, s1.vy, s1.hp, s1.facing, s1.stateFrame, s1.proj,
      s2.x, s2.y, s2.vx, s2.vy, s2.hp, s2.facing, s2.stateFrame, s2.proj,
      this.timerFrames & 0xFFFF, this.round
    ];
    for (const n of nums) { h = (Math.imul(31, h) + n) | 0; }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  // ─── Snapshot & restore for rollback ─────────────────────────────────────────
  snapshot() {
    return JSON.parse(JSON.stringify({
      p1: this.p1, p2: this.p2, round: this.round,
      timerFrames: this.timerFrames, phase: this.phase,
      phaseFrames: this.phaseFrames, winnerId: this.winnerId,
      lastP1Input: this.lastP1Input, lastP2Input: this.lastP2Input
    }));
  }

  restore(snap) {
    const s = JSON.parse(JSON.stringify(snap));
    Object.assign(this.p1, s.p1);
    Object.assign(this.p2, s.p2);
    this.round        = s.round;
    this.timerFrames  = s.timerFrames;
    this.phase        = s.phase;
    this.phaseFrames  = s.phaseFrames;
    this.winnerId     = s.winnerId;
    this.lastP1Input  = s.lastP1Input;
    this.lastP2Input  = s.lastP2Input;
    // Re-attach config (lost in JSON serialize)
    this.p1.config = CHAR_CONFIG[this.p1.name] || CHAR_CONFIG.Iori;
    this.p2.config = CHAR_CONFIG[this.p2.name] || CHAR_CONFIG.Kyo;
  }
}

// ─── Canvas Renderer ──────────────────────────────────────────────────────────
export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
  }

  draw(game) {
    const ctx = this.ctx;
    const W = STAGE_W, H = STAGE_H;

    // Background
    ctx.fillStyle = '#090c13';
    ctx.fillRect(0, 0, W, H);

    // Stage gradient floor
    const floorGrad = ctx.createLinearGradient(0, FLOOR_Y, 0, H);
    floorGrad.addColorStop(0, '#1a1030');
    floorGrad.addColorStop(1, '#0a0810');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);

    // Floor line
    ctx.strokeStyle = '#4400aa';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, FLOOR_Y); ctx.lineTo(W, FLOOR_Y); ctx.stroke();

    // Grid lines on floor
    ctx.strokeStyle = 'rgba(80,0,160,0.2)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, FLOOR_Y); ctx.lineTo(x, H); ctx.stroke();
    }

    // Background crowd (simple shapes)
    this._drawCrowd(ctx);

    // Phase overlay
    if (game.phase === 'ROUND_START') {
      this._drawRoundStart(ctx, game);
    } else if (game.phase === 'MATCH_END') {
      this._drawMatchEnd(ctx, game);
    }

    // Fighters
    this._drawFighter(ctx, game.p1, 1);
    this._drawFighter(ctx, game.p2, 2);

    // Projectiles
    [game.p1, game.p2].forEach(f => {
      if (f.projectile) this._drawProjectile(ctx, f.projectile, f.config);
    });

    // HUD
    this._drawHUD(ctx, game);
  }

  _drawCrowd(ctx) {
    const colors = ['#220044','#330055','#440066','#110033'];
    for (let i = 0; i < 30; i++) {
      const x = (i * 27) % STAGE_W;
      const y = 250 + (i % 4) * 8;
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawFighter(ctx, f, slot) {
    if (f.hp <= 0 && f.state !== 'KO') return;

    const x = Math.round(f.x);
    const y = Math.round(f.y);
    const facing = f.facing;
    const cfg = f.config;

    ctx.save();
    ctx.translate(x, y);
    if (facing === -1) ctx.scale(-1, 1);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 28, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hit flash
    const isHit = f.state === 'HIT' || f.hitstopFrames > 0;
    const isKO  = f.state === 'KO';
    const bodyColor = isHit ? cfg.hitColor : (isKO ? '#555' : cfg.color);

    // Legs
    const legsY  = isKO ? -10 : (f.state === 'CROUCH' ? -20 : -28);
    const legOff = f.state === 'WALK_FWD' ? Math.sin(Date.now() / 100) * 8 : 0;
    ctx.fillStyle = bodyColor;
    ctx.fillRect(-10, legsY, 8, isKO ? 10 : 28);
    ctx.fillRect(2, legsY + legOff, 8, isKO ? 10 : 28);

    // Body / Torso
    const bodyH = f.state === 'CROUCH' ? 40 : 55;
    const bodyY = isKO ? -20 : -(bodyH + legsY - legsY);
    ctx.fillStyle = bodyColor;
    ctx.fillRect(-16, isKO ? -30 : -(bodyH + 28), 32, bodyH);

    // Arms
    const attackingA = f.state.startsWith('ATTACK') && f.hitActive;
    const armExtend  = attackingA ? 30 : 10;
    ctx.fillStyle = bodyColor;
    ctx.fillRect(12, isKO ? -45 : -(bodyH + 20), armExtend, 10);  // fwd arm
    ctx.fillRect(-22, isKO ? -45 : -(bodyH + 20), 10, 10);

    // Head
    const headY = isKO ? -55 : -(bodyH + 28 + 22);
    ctx.fillStyle = '#ffd1b3';
    ctx.beginPath();
    ctx.arc(0, headY, 14, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = isKO ? '#666' : cfg.accentColor;
    ctx.beginPath(); ctx.arc(5, headY - 3, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-5, headY - 3, 2, 0, Math.PI * 2); ctx.fill();

    // Attack glow
    if (attackingA) {
      ctx.fillStyle = cfg.accentColor + '88';
      ctx.beginPath();
      ctx.arc(40, isKO ? -45 : -(bodyH + 16), 18, 0, Math.PI * 2);
      ctx.fill();
    }

    // Hitbox debug (can toggle)
    if (window.__debugHitboxes && f.hitActive) {
      const ad = f.attackData;
      if (ad) {
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 2;
        ctx.strokeRect(10, ad.yOffset, ad.hitboxW, ad.hitboxH);
      }
    }

    ctx.restore();
  }

  _drawProjectile(ctx, proj, cfg) {
    ctx.save();
    ctx.translate(Math.round(proj.x), Math.round(proj.y));
    const t = Date.now() / 80;
    ctx.rotate(t);
    ctx.fillStyle = (cfg || { projectileColor: '#cc00ff' }).projectileColor;
    for (let i = 0; i < 6; i++) {
      ctx.rotate(Math.PI / 3);
      ctx.fillRect(-4, -15, 8, 30);
    }
    ctx.restore();
  }

  _drawHUD(ctx, game) {
    const p1 = game.p1, p2 = game.p2;

    // P1 HP bar
    const hpBarW = 280;
    ctx.fillStyle = '#1a0030';
    ctx.fillRect(20, 18, hpBarW, 18);
    const p1HpW = Math.max(0, Math.round((p1.hp / MAX_HP) * hpBarW));
    const p1HpGrad = ctx.createLinearGradient(20, 0, 20 + hpBarW, 0);
    p1HpGrad.addColorStop(0, p1.hp > 300 ? '#00ff88' : p1.hp > 100 ? '#ffcc00' : '#ff2200');
    p1HpGrad.addColorStop(1, p1.hp > 300 ? '#00cc66' : p1.hp > 100 ? '#ff8800' : '#cc0000');
    ctx.fillStyle = p1HpGrad;
    ctx.fillRect(20, 18, p1HpW, 18);
    ctx.strokeStyle = '#00e5ff44'; ctx.lineWidth = 1;
    ctx.strokeRect(20, 18, hpBarW, 18);

    // P1 name
    ctx.fillStyle = p1.config.accentColor;
    ctx.font = '700 13px "Chakra Petch", sans-serif';
    ctx.fillText(p1.name + ' [P1]', 20, 14);

    // P2 HP bar (right-aligned)
    const p2HpW = Math.max(0, Math.round((p2.hp / MAX_HP) * hpBarW));
    ctx.fillStyle = '#1a0030';
    ctx.fillRect(STAGE_W - 20 - hpBarW, 18, hpBarW, 18);
    const p2HpGrad = ctx.createLinearGradient(STAGE_W - 20 - hpBarW, 0, STAGE_W - 20, 0);
    p2HpGrad.addColorStop(0, p2.hp > 300 ? '#00cc66' : p2.hp > 100 ? '#ff8800' : '#cc0000');
    p2HpGrad.addColorStop(1, p2.hp > 300 ? '#00ff88' : p2.hp > 100 ? '#ffcc00' : '#ff2200');
    ctx.fillStyle = p2HpGrad;
    ctx.fillRect(STAGE_W - 20 - p2HpW, 18, p2HpW, 18);
    ctx.strokeStyle = '#00e5ff44'; ctx.lineWidth = 1;
    ctx.strokeRect(STAGE_W - 20 - hpBarW, 18, hpBarW, 18);

    // P2 name
    ctx.fillStyle = p2.config.accentColor;
    ctx.textAlign = 'right';
    ctx.fillText(p2.name + ' [P2]', STAGE_W - 20, 14);
    ctx.textAlign = 'left';

    // Timer
    const secs = Math.ceil(game.timerFrames / FPS);
    const timerColor = secs <= 10 ? '#ff2200' : '#ffcc00';
    ctx.fillStyle = '#0a0518';
    ctx.fillRect(STAGE_W / 2 - 28, 10, 56, 30);
    ctx.strokeStyle = timerColor + '88';
    ctx.lineWidth = 2;
    ctx.strokeRect(STAGE_W / 2 - 28, 10, 56, 30);
    ctx.fillStyle = timerColor;
    ctx.font = '700 22px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(secs).padStart(2, '0'), STAGE_W / 2, 32);
    ctx.textAlign = 'left';

    // Round wins indicators
    for (let i = 0; i < 2; i++) {
      const filled = i < p1.roundWins;
      ctx.beginPath();
      ctx.arc(310 + i * 18, 22, 6, 0, Math.PI * 2);
      ctx.fillStyle = filled ? p1.config.accentColor : '#2a1040';
      ctx.fill();
    }
    for (let i = 0; i < 2; i++) {
      const filled = i < p2.roundWins;
      ctx.beginPath();
      ctx.arc(STAGE_W - 310 - i * 18, 22, 6, 0, Math.PI * 2);
      ctx.fillStyle = filled ? p2.config.accentColor : '#2a1040';
      ctx.fill();
    }
  }

  _drawRoundStart(ctx, game) {
    const progress = game.phaseFrames / 90;
    const alpha = progress < 0.2 ? progress / 0.2 : progress > 0.8 ? (1 - progress) / 0.2 : 1;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    ctx.fillStyle = '#ffcc00';
    ctx.font = '800 64px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    const label = game.round === 1 ? 'ROUND 1' : game.round === 2 ? 'ROUND 2' : 'ROUND FINAL';
    ctx.fillText(label, STAGE_W / 2, STAGE_H / 2 - 20);
    ctx.fillStyle = '#00e5ff';
    ctx.font = '700 28px "Chakra Petch", sans-serif';
    ctx.fillText('FIGHT!', STAGE_W / 2, STAGE_H / 2 + 30);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  _drawMatchEnd(ctx, game) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    const winner = game.winnerId === 1 ? game.p1 : game.p2;
    ctx.fillStyle = winner.config.accentColor;
    ctx.font = '800 56px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('K.O.', STAGE_W / 2, STAGE_H / 2 - 20);
    ctx.fillStyle = '#fff';
    ctx.font = '700 26px "Chakra Petch", sans-serif';
    ctx.fillText(winner.name + ' VENCEU!', STAGE_W / 2, STAGE_H / 2 + 30);
    ctx.textAlign = 'left';
    ctx.restore();
  }
}
