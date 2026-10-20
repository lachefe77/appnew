/**
 * ARENA ARCADE — Character Select Screen
 * Tela de seleção de personagem sincronizada entre P1 e P2.
 * 44 personagens do KOF 2002 (Magic Plus II roster completo).
 * Envia SELECT_CHARACTER via WS; aguarda confirmação do oponente.
 */

export const KOF2002_ROSTER = [
  // Equipe Kusanagi
  { id: 'kyo',     name: 'Kyo Kusanagi',     color: '#ff8800', accent: '#ffdd00', icon: '⚡', tier: 'S', origin: 'Japão' },
  { id: 'benimaru',name: 'Benimaru Nikaido',  color: '#ffdd00', accent: '#ffffff', icon: '⚡', tier: 'A', origin: 'Japão' },
  { id: 'daimon',  name: 'Goro Daimon',       color: '#4488ff', accent: '#aaddff', icon: '🥋', tier: 'B', origin: 'Japão' },
  // Equipe Fatal Fury
  { id: 'terry',   name: 'Terry Bogard',       color: '#ff6600', accent: '#ffaa00', icon: '🧢', tier: 'S', origin: 'EUA' },
  { id: 'andy',    name: 'Andy Bogard',         color: '#ffffff', accent: '#00aaff', icon: '🥷', tier: 'A', origin: 'EUA' },
  { id: 'joe',     name: 'Joe Higashi',         color: '#ffdd00', accent: '#ff4400', icon: '👊', tier: 'A', origin: 'Tailândia' },
  // Equipe Art of Fighting
  { id: 'ryo',     name: 'Ryo Sakazaki',        color: '#ff8800', accent: '#ffcc00', icon: '🥊', tier: 'A', origin: 'Japão' },
  { id: 'robert',  name: 'Robert Garcia',       color: '#0044ff', accent: '#00aaff', icon: '🥊', tier: 'A', origin: 'Itália' },
  { id: 'takuma',  name: 'Takuma Sakazaki',     color: '#884400', accent: '#cc6600', icon: '👴', tier: 'B', origin: 'Japão' },
  // Equipe Ikari
  { id: 'ralf',    name: 'Ralf Jones',           color: '#228822', accent: '#00ff88', icon: '💪', tier: 'B', origin: 'EUA' },
  { id: 'clark',   name: 'Clark Still',          color: '#444444', accent: '#aaaaaa', icon: '💪', tier: 'B', origin: 'EUA' },
  { id: 'leona',   name: 'Leona Heidern',        color: '#0055cc', accent: '#44aaff', icon: '🔵', tier: 'A', origin: 'Desconhecido' },
  // Equipe Psycho Soldiers
  { id: 'athena',  name: 'Athena Asamiya',       color: '#ff44aa', accent: '#ffaadd', icon: '⚜️', tier: 'A', origin: 'Japão' },
  { id: 'kensou',  name: 'Sie Kensou',            color: '#ff4400', accent: '#ff8800', icon: '🐉', tier: 'B', origin: 'China' },
  { id: 'chin',    name: 'Chin Gentsai',          color: '#ffdd00', accent: '#ff8800', icon: '🍶', tier: 'C', origin: 'China' },
  // Equipe Women Fighters
  { id: 'mai',     name: 'Mai Shiranui',          color: '#ff2222', accent: '#ff8888', icon: '🌸', tier: 'A', origin: 'Japão' },
  { id: 'king',    name: 'King',                  color: '#4422aa', accent: '#aa66ff', icon: '♠️', tier: 'B', origin: 'França' },
  { id: 'yuri',    name: 'Yuri Sakazaki',         color: '#ff44aa', accent: '#ff88cc', icon: '🌺', tier: 'B', origin: 'Japão' },
  // Equipe '97 Special
  { id: 'chizuru', name: 'Chizuru Kagura',        color: '#aa88ff', accent: '#ddbbff', icon: '🔮', tier: 'A', origin: 'Japão' },
  { id: 'mature',  name: 'Mature',                color: '#cc4488', accent: '#ff88cc', icon: '🌹', tier: 'S', origin: 'Desconhecido' },
  { id: 'vice',    name: 'Vice',                  color: '#8800cc', accent: '#cc44ff', icon: '💀', tier: 'S', origin: 'Desconhecido' },
  // Equipe Yagami
  { id: 'iori',    name: 'Iori Yagami',           color: '#cc00ff', accent: '#ff0055', icon: '🔥', tier: 'S', origin: 'Japão' },
  { id: 'billy',   name: 'Billy Kane',             color: '#ff6600', accent: '#ffcc00', icon: '🏒', tier: 'A', origin: 'Inglaterra' },
  { id: 'goro',    name: 'Geese Howard',           color: '#cc0000', accent: '#ff4444', icon: '💢', tier: 'S', origin: 'EUA' },
  // Equipe Korea
  { id: 'kim',     name: 'Kim Kaphwan',            color: '#0044cc', accent: '#00aaff', icon: '🦅', tier: 'S', origin: 'Coreia' },
  { id: 'chang',   name: 'Chang Koehan',           color: '#884400', accent: '#cc8800', icon: '⚫', tier: 'C', origin: 'Coreia' },
  { id: 'choi',    name: 'Choi Bounge',            color: '#228800', accent: '#00ff00', icon: '🪃', tier: 'C', origin: 'Coreia' },
  // Equipe Mexico
  { id: 'rampage', name: 'Vanessa',                color: '#ff4422', accent: '#ff8844', icon: '🥊', tier: 'A', origin: 'EUA' },
  { id: 'seth',    name: 'Seth',                   color: '#4444cc', accent: '#8888ff', icon: '🔫', tier: 'A', origin: 'EUA' },
  { id: 'ramon',   name: 'Ramon',                  color: '#ffdd00', accent: '#ff8800', icon: '🤸', tier: 'A', origin: 'México' },
  // Equipe NESTS
  { id: 'kyo2',    name: 'Kyo-1 & Kyo-2',         color: '#ff6600', accent: '#ffaa00', icon: '🤖', tier: 'A', origin: 'Japão' },
  { id: 'whip',    name: 'Whip',                   color: '#aa6600', accent: '#cc9900', icon: '🪢', tier: 'B', origin: 'Desconhecido' },
  { id: 'k',       name: "K'",                     color: '#ff4400', accent: '#ffaa00', icon: '💥', tier: 'S', origin: 'Alemanha' },
  { id: 'maxima',  name: 'Maxima',                 color: '#888888', accent: '#cccccc', icon: '🤖', tier: 'B', origin: 'Canadá' },
  { id: 'k9999',   name: 'K9999',                  color: '#cc0000', accent: '#ff4444', icon: '🔴', tier: 'A', origin: 'Desconhecido' },
  { id: 'angel',   name: 'Angel',                  color: '#ff88aa', accent: '#ffbbcc', icon: '😈', tier: 'A', origin: 'México' },
  { id: 'lin',     name: 'Lin',                    color: '#220044', accent: '#8800cc', icon: '☠️', tier: 'B', origin: 'China' },
  { id: 'benimaru2',name: 'May Lee',               color: '#ff44aa', accent: '#ffaadd', icon: '⭐', tier: 'B', origin: 'Coreia' },
  // Equipe Especial
  { id: 'heidern', name: 'Heidern',               color: '#004488', accent: '#0088ff', icon: '🎖️', tier: 'B', origin: 'EUA' },
  { id: 'bluemary',name: 'Blue Mary',              color: '#2244cc', accent: '#6688ff', icon: '🔵', tier: 'A', origin: 'EUA' },
  { id: 'iori2',   name: 'Xiangfei Li',            color: '#ff8844', accent: '#ffbb88', icon: '🥢', tier: 'C', origin: 'China' },
  // Bosses
  { id: 'omega',   name: 'Omega Rugal',            color: '#00ccff', accent: '#00ffff', icon: '👑', tier: 'EX', origin: 'Alemanha' },
  { id: 'rugal',   name: 'Rugal Bernstein',        color: '#8800cc', accent: '#cc44ff', icon: '💀', tier: 'EX', origin: 'Alemanha' },
  { id: 'igniz',   name: 'Igniz',                  color: '#ff0088', accent: '#ff44cc', icon: '🌌', tier: 'EX', origin: 'Desconhecido' },
];

export class CharacterSelect {
  constructor(ws, matchId, localSlot) {
    this.ws = ws;
    this.matchId = matchId;
    this.localSlot = localSlot;
    this.selectedChar = null;
    this.opponentChar = null;
    this.confirmed = false;
    this.opponentConfirmed = false;
    this.el = null;
    this._onSelect = null; // callback(p1Char, p2Char)
  }

  open(onSelect) {
    this._onSelect = onSelect;
    this.el = this._buildUI();
    document.body.appendChild(this.el);
  }

  _buildUI() {
    const overlay = document.createElement('div');
    overlay.id = 'charSelectOverlay';
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(5,8,15,0.97);
      z-index:3000; display:flex; flex-direction:column;
      align-items:center; font-family:'Chakra Petch',sans-serif;
      overflow-y:auto;
    `;

    const tierColors = { S: '#ffcc00', A: '#00e5ff', B: '#00ff88', C: '#888', EX: '#ff0055' };

    overlay.innerHTML = `
      <div style="width:100%; max-width:1100px; padding:24px 16px;">
        <div style="text-align:center; margin-bottom:24px;">
          <div style="font-size:0.75rem; color:#8494ab; letter-spacing:2px; font-weight:700;">KOF 2002 — MAGIC PLUS II</div>
          <h2 style="font-size:2rem; font-weight:800; color:#fff; margin:6px 0;">ESCOLHA SEU LUTADOR</h2>
          <div id="csTimer" style="font-size:1.1rem; color:#ffcc00; font-family:'JetBrains Mono',monospace;">30s para selecionar</div>
        </div>

        <div style="display:flex; gap:16px; justify-content:center; margin-bottom:20px;">
          <div id="csP1Preview" style="flex:1; max-width:220px; background:#10141e; border:2px solid #242e42; border-radius:10px; padding:16px; text-align:center; min-height:100px;">
            <div style="font-size:0.7rem; color:#ff8800; font-weight:800;">P1</div>
            <div id="csP1Name" style="font-size:1rem; font-weight:700; margin-top:4px; color:#fff;">—</div>
          </div>
          <div style="display:flex; align-items:center; font-size:2rem; font-weight:900; color:#ff0055;">VS</div>
          <div id="csP2Preview" style="flex:1; max-width:220px; background:#10141e; border:2px solid #242e42; border-radius:10px; padding:16px; text-align:center; min-height:100px;">
            <div style="font-size:0.7rem; color:#00e5ff; font-weight:800;">P2</div>
            <div id="csP2Name" style="font-size:1rem; font-weight:700; margin-top:4px; color:#fff;">—</div>
          </div>
        </div>

        <div id="csGrid" style="
          display:grid;
          grid-template-columns:repeat(auto-fill,minmax(90px,1fr));
          gap:8px; margin-bottom:20px;
        "></div>

        <div style="text-align:center;">
          <button id="csConfirmBtn" disabled style="
            background:linear-gradient(135deg,#ff4d00,#ff0055);
            color:#fff; border:none; padding:14px 40px;
            font-family:'Chakra Petch',sans-serif; font-size:1rem; font-weight:800;
            border-radius:8px; cursor:pointer; opacity:0.5;
          ">CONFIRMAR SELEÇÃO</button>
          <div id="csStatusMsg" style="margin-top:10px; font-size:0.85rem; color:#8494ab;"></div>
        </div>
      </div>
    `;

    // Build grid
    const grid = overlay.querySelector('#csGrid');
    KOF2002_ROSTER.forEach(char => {
      const card = document.createElement('div');
      card.dataset.charId = char.id;
      card.style.cssText = `
        background:#10141e; border:2px solid #242e42; border-radius:8px;
        padding:10px 6px; text-align:center; cursor:pointer;
        transition:all 0.15s; position:relative;
      `;
      card.innerHTML = `
        <div style="font-size:1.5rem;">${char.icon}</div>
        <div style="font-size:0.65rem; font-weight:700; color:#f0f4fa; margin-top:4px; line-height:1.2;">${char.name.split(' ')[0]}</div>
        <div style="font-size:0.55rem; color:${tierColors[char.tier] || '#888'}; font-weight:800; margin-top:2px;">TIER ${char.tier}</div>
      `;
      card.onmouseenter = () => { if (!card.classList.contains('selected')) card.style.borderColor = char.color; };
      card.onmouseleave = () => { if (!card.classList.contains('selected')) card.style.borderColor = '#242e42'; };
      card.onclick = () => this._selectChar(char, card, overlay);
      grid.appendChild(card);
    });

    // Confirm button
    overlay.querySelector('#csConfirmBtn').onclick = () => this._confirm(overlay);

    // Timer
    let remaining = 30;
    const timerEl = overlay.querySelector('#csTimer');
    const timerInterval = setInterval(() => {
      remaining--;
      timerEl.textContent = `${remaining}s para selecionar`;
      timerEl.style.color = remaining <= 10 ? '#ff2200' : '#ffcc00';
      if (remaining <= 0) {
        clearInterval(timerInterval);
        // Auto-select random if not selected
        if (!this.selectedChar) {
          const rand = KOF2002_ROSTER[Math.floor(Math.random() * 20)];
          const card = overlay.querySelector(`[data-char-id="${rand.id}"]`);
          if (card) this._selectChar(rand, card, overlay);
        }
        if (!this.confirmed) this._confirm(overlay);
      }
    }, 1000);
    overlay._timerInterval = timerInterval;

    return overlay;
  }

  _selectChar(char, card, overlay) {
    if (this.confirmed) return;
    this.selectedChar = char;

    // Reset all cards
    overlay.querySelectorAll('[data-char-id]').forEach(c => {
      c.style.borderColor = '#242e42';
      c.classList.remove('selected');
    });

    card.style.borderColor = char.color;
    card.style.boxShadow = `0 0 12px ${char.color}88`;
    card.classList.add('selected');

    // Update P1 preview
    const nameEl = overlay.querySelector(`#cs${this.localSlot === 1 ? 'P1' : 'P2'}Name`);
    if (nameEl) nameEl.textContent = char.name;

    const btn = overlay.querySelector('#csConfirmBtn');
    btn.disabled = false;
    btn.style.opacity = '1';

    // Send preview to opponent (non-confirmed)
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'CHAR_PREVIEW',
        matchId: this.matchId,
        charId: char.id
      }));
    }
  }

  _confirm(overlay) {
    if (!this.selectedChar || this.confirmed) return;
    this.confirmed = true;

    const btn = overlay.querySelector('#csConfirmBtn');
    btn.textContent = 'AGUARDANDO OPONENTE...';
    btn.disabled = true;
    btn.style.background = '#242e42';

    const statusEl = overlay.querySelector('#csStatusMsg');
    statusEl.textContent = `✅ ${this.selectedChar.name} confirmado! Aguardando oponente...`;
    statusEl.style.color = '#00ff88';

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'SELECT_CHARACTER',
        matchId: this.matchId,
        charId: this.selectedChar.id,
        charName: this.selectedChar.name
      }));
    }

    this._checkBothConfirmed(overlay);
  }

  opponentSelected(charId, overlay) {
    const char = KOF2002_ROSTER.find(c => c.id === charId);
    this.opponentChar = char || { id: charId, name: charId, color: '#888' };
    this.opponentConfirmed = true;

    const nameEl = overlay
      ? overlay.querySelector(`#cs${this.localSlot === 1 ? 'P2' : 'P1'}Name`)
      : document.querySelector(`#cs${this.localSlot === 1 ? 'P2' : 'P1'}Name`);
    if (nameEl && char) nameEl.textContent = char.name;

    this._checkBothConfirmed(overlay || this.el);
  }

  _checkBothConfirmed(overlay) {
    if (!this.confirmed || !this.opponentConfirmed) return;

    clearInterval(overlay && overlay._timerInterval);

    const p1Char = this.localSlot === 1 ? this.selectedChar : this.opponentChar;
    const p2Char = this.localSlot === 1 ? this.opponentChar : this.selectedChar;

    setTimeout(() => {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (this._onSelect) this._onSelect(p1Char, p2Char);
    }, 800);
  }

  close() {
    if (this.el) {
      clearInterval(this.el._timerInterval);
      if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
    }
  }
}
