class ArcadeAudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // Generic dispatcher — maps name strings to methods
  play(name) {
    switch ((name || '').toUpperCase()) {
      case 'COIN':            this.playCoin(); break;
      case 'HIT':             this.playHit(false); break;
      case 'HEAVY_HIT':       this.playHit(true); break;
      case 'CHALLENGE_ALERT': this.playChallengeAlert(); break;
      case 'KO':              this.playKo(); break;
      case 'VICTORY':         this.playVictory(); break;
      default: break;
    }
  }

  playCoin() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc1.type = 'sine';    osc1.frequency.setValueAtTime(987.77, now);  osc1.frequency.setValueAtTime(1318.51, now + 0.08);
    osc2.type = 'triangle'; osc2.frequency.setValueAtTime(1975.53, now); osc2.frequency.setValueAtTime(2637.02, now + 0.08);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc1.connect(gain); osc2.connect(gain); gain.connect(this.ctx.destination);
    osc1.start(now); osc2.start(now); osc1.stop(now + 0.45); osc2.stop(now + 0.45);
  }

  playHit(isHeavy = false) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = isHeavy ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(isHeavy ? 160 : 220, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + (isHeavy ? 0.18 : 0.1));
    gain.gain.setValueAtTime(isHeavy ? 0.5 : 0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (isHeavy ? 0.18 : 0.1));
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.start(now); osc.stop(now + (isHeavy ? 0.18 : 0.1));
  }

  playChallengeAlert() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    [0, 0.1, 0.2].forEach((delay, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(587.33 + i * 150, now + delay);
      gain.gain.setValueAtTime(0.2, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.01, now + delay + 0.08);
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.start(now + delay); osc.stop(now + delay + 0.08);
    });
  }

  playKo() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.8);
    gain.gain.setValueAtTime(0.6, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.start(now); osc.stop(now + 1.2);
  }

  playVictory() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const t = now + idx * 0.12;
      osc.type = 'triangle'; osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.3, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.start(t); osc.stop(t + 0.3);
    });
  }
}

const arcadeAudio = new ArcadeAudioEngine();

// Expose globally so index.html can call window.ArcadeAudio.play(...)
window.ArcadeAudio = arcadeAudio;
