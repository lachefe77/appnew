export const ACTIONS = [
  [4, "Cima"],
  [5, "Baixo"],
  [6, "Esquerda"],
  [7, "Direita"],
  [0, "Golpe 1"],
  [8, "Golpe 2"],
  [1, "Golpe 3"],
  [9, "Golpe 4"],
  [3, "Start"],
  [2, "Ficha (Y)"],
];
export const DEFAULT_KEYS = {
  ArrowUp: 4,
  ArrowDown: 5,
  ArrowLeft: 6,
  ArrowRight: 7,
  KeyZ: 0,
  KeyX: 8,
  KeyA: 1,
  KeyS: 9,
  Enter: 3,
  KeyY: 2,
};
export const DEFAULT_PAD = {
  0: 0,
  1: 8,
  2: 1,
  3: 9,
  8: 2,
  9: 3,
  12: 4,
  13: 5,
  14: 6,
  15: 7,
};
const KEY = "arena.controls.v2"; // v2: Ficha = KeyY (antes Digit5)
const validAction = (n) => ACTIONS.some(([b]) => b === n);
const validCode = (code) =>
  /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Enter|Space|Shift(Left|Right)|Control(Left|Right)|Numpad[0-9])$/.test(
    code,
  );
export function normalizeSettings(raw = {}) {
  const keyboard = Object.fromEntries(
    Object.entries(raw.keyboard || DEFAULT_KEYS).filter(
      ([code, b]) => validCode(code) && validAction(b),
    ),
  );
  // Require every action exactly once, so a corrupted preference cannot trap a player.
  const complete =
    ACTIONS.every(([b]) => Object.values(keyboard).includes(b)) &&
    new Set(Object.values(keyboard)).size === Object.keys(keyboard).length;
  const pads = Object.create(null);
  for (const [id, profile] of Object.entries(raw.pads || {}).slice(0, 20)) {
    if (!profile || typeof profile !== "object") continue;
    const buttons = Object.fromEntries(
      Object.entries(profile.buttons || DEFAULT_PAD).filter(
        ([i, b]) => /^\d{1,3}$/.test(i) && Number(i) < 128 && validAction(b),
      ),
    );
    pads[id] = {
      buttons,
      axisX:
        Number.isInteger(profile.axisX) &&
        profile.axisX >= 0 &&
        profile.axisX < 16
          ? profile.axisX
          : 0,
      axisY:
        Number.isInteger(profile.axisY) &&
        profile.axisY >= 0 &&
        profile.axisY < 16
          ? profile.axisY
          : 1,
      deadzone: Number.isFinite(profile.deadzone)
        ? Math.min(0.9, Math.max(0.1, profile.deadzone))
        : 0.4,
    };
  }
  return {
    keyboard: complete ? keyboard : { ...DEFAULT_KEYS },
    device: typeof raw.device === "string" ? raw.device : "auto",
    pads,
  };
}
export function loadSettings() {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(KEY) || "{}"));
  } catch {
    return normalizeSettings();
  }
}
let settings = loadSettings();
let dialog,
  raf,
  capture = null,
  neutral = false;
const element = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
export function getSettings() {
  return settings;
}
export function isConfiguring() {
  return Boolean(dialog?.open);
}
export function getPads() {
  try {
    return Array.from(navigator.getGamepads?.() || []).filter(
      (p) => p?.connected,
    );
  } catch {
    return [];
  }
}
export function selectPad(pads, config = settings) {
  return config.device === "auto"
    ? pads[0]
    : pads.find((p) => p.id === config.device);
}
export function padProfile(pad, config = settings) {
  return (
    config.pads[pad.id] || {
      buttons: { ...DEFAULT_PAD },
      axisX: 0,
      axisY: 1,
      deadzone: 0.4,
    }
  );
}
export function padButtons(pad, config = settings) {
  const result = new Set();
  if (!pad) return result;
  const profile = padProfile(pad, config);
  for (const [index, action] of Object.entries(profile.buttons))
    if (pad.buttons[index]?.pressed) result.add(action);
  const x = pad.axes[profile.axisX] || 0,
    y = pad.axes[profile.axisY] || 0;
  if (x < -profile.deadzone) result.add(6);
  if (x > profile.deadzone) result.add(7);
  if (y < -profile.deadzone) result.add(4);
  if (y > profile.deadzone) result.add(5);
  return result;
}
function save() {
  settings = normalizeSettings(settings);
  let saved = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    saved = false;
  }
  // Espelha no perfil da conta (SQLite) quando autenticado.
  try {
    const token =
      window.app?.sessionToken || localStorage.getItem("arenaToken");
    if (token) {
      fetch("/api/me/controls", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ controls: settings }),
      }).catch(() => {});
    }
  } catch {}
  window.dispatchEvent(new Event("arena-controls-changed"));
  if (dialog)
    dialog.querySelector("[data-save]").textContent = saved
      ? "Configuração salva neste navegador e na conta."
      : "Aplicado nesta sessão; o navegador bloqueou o armazenamento.";
}
/** Carrega perfil da conta e mescla sobre localStorage (login). */
export async function syncControlsFromAccount(token) {
  if (!token) return settings;
  try {
    const r = await fetch("/api/me/controls", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!r.ok) return settings;
    const data = await r.json();
    if (data.controls) {
      settings = normalizeSettings(data.controls);
      try {
        localStorage.setItem(KEY, JSON.stringify(settings));
      } catch {}
      window.dispatchEvent(new Event("arena-controls-changed"));
    }
  } catch {}
  return settings;
}
export function keyLabel(code) {
  return code
    .replace(/^Key|^Digit/, "")
    .replace("ArrowUp", "↑")
    .replace("ArrowDown", "↓")
    .replace("ArrowLeft", "←")
    .replace("ArrowRight", "→");
}
function renderBindings() {
  const keyboard = dialog.querySelector("[data-keyboard]");
  keyboard.replaceChildren();
  const pad = selectPad(getPads()),
    profile = pad && padProfile(pad);
  const buttons = dialog.querySelector("[data-bindings]");
  buttons.replaceChildren();
  for (const [action, label] of ACTIONS) {
    const row = element("div", "control-binding");
    row.append(element("span", "", label));
    const bind = element(
      "button",
      "control-key",
      keyLabel(
        Object.keys(settings.keyboard).find(
          (k) => settings.keyboard[k] === action,
        ) || "—",
      ),
    );
    bind.type = "button";
    bind.onclick = () => {
      capture = { kind: "key", action };
      bind.textContent = "Pressione…";
    };
    row.append(bind);
    keyboard.append(row);
    const item = element("div", "control-binding");
    item.append(element("span", "", label));
    const index =
      profile &&
      Object.keys(profile.buttons).find((k) => profile.buttons[k] === action);
    const change = element(
      "button",
      "control-key",
      index === undefined ? "Mapear" : `Botão ${Number(index) + 1}`,
    );
    change.type = "button";
    change.disabled = !pad;
    change.onclick = () => {
      capture = { kind: "pad", action, id: pad.id };
      neutral = false;
      change.textContent = "Solte e pressione…";
    };
    item.append(change);
    buttons.append(item);
  }
  for (const [name, value] of Object.entries(
    profile || { axisX: 0, axisY: 1, deadzone: 0.4 },
  )) {
    const input = dialog.querySelector(`[name="${name}"]`);
    if (input) input.value = value;
  }
}
export function openControls() {
  if (dialog?.open) return;
  dialog = element("dialog", "controls-dialog");
  dialog.setAttribute("aria-labelledby", "controlsTitle");
  dialog.innerHTML = `<div class="controls-heading"><div><span class="portal-eyebrow">PREFERÊNCIAS LOCAIS</span><h2 id="controlsTitle">Seu controle. Seu jeito de jogar.</h2></div><button type="button" data-close aria-label="Fechar controles">✕</button></div>
  <p class="controls-intro">Conecte por USB ou pareie pelo sistema. Com esta janela aberta, pressione um botão do controle para o navegador reconhecê-lo. O teste não envia comandos à partida.</p>
  <label class="control-device">Dispositivo <select data-device><option value="auto">Automático · primeiro conectado</option></select></label>
  <p data-device-status role="status"></p><div class="control-live" aria-label="Teste de comandos"><strong data-live>Pressione um botão ou mova o direcional.</strong><span data-raw></span></div>
  <div class="controls-columns"><section><h3>Teclado</h3><p>Clique na tecla e pressione a substituta.</p><div data-keyboard></div></section><section><h3>Joystick / arcade</h3><p>Clique em Mapear e pressione o botão físico.</p><div data-bindings></div></section></div>
  <div class="controls-calibration"><label>Eixo horizontal <input name="axisX" type="number" min="0" max="15" step="1"></label><label>Eixo vertical <input name="axisY" type="number" min="0" max="15" step="1"></label><label>Zona morta <input name="deadzone" type="number" min="0.1" max="0.9" step="0.05"></label></div>
  <p class="controls-note">Xbox e PlayStation usam o padrão reconhecido pelo navegador. Controles arcade fora desse padrão podem precisar de remapeamento. Adaptadores que simulam teclado usam as teclas acima. Na partida do servidor, a ficha permanece reservada ao servidor.</p>
  <footer><span data-save role="status">As alterações ficam neste navegador.</span><button type="button" data-reset>Restaurar padrão</button><button type="button" data-done>Concluir</button></footer>`;
  document.body.append(dialog);
  let signature = "";
  const refreshDevices = () => {
    const pads = getPads(),
      next = pads.map((p) => `${p.index}:${p.id}`).join("|");
    if (next === signature) return;
    signature = next;
    const select = dialog.querySelector("[data-device]");
    select.replaceChildren(
      new Option("Automático · primeiro conectado", "auto"),
    );
    for (const p of pads) select.add(new Option(p.id, p.id));
    if (
      settings.device !== "auto" &&
      !pads.some((p) => p.id === settings.device)
    )
      select.add(
        new Option(`${settings.device} · desconectado`, settings.device),
      );
    select.value = settings.device;
    renderBindings();
  };
  const close = () => dialog.close();
  dialog.querySelector("[data-close]").onclick = close;
  dialog.querySelector("[data-done]").onclick = close;
  dialog.querySelector("[data-reset]").onclick = () => {
    settings = normalizeSettings();
    capture = null;
    signature = "reset";
    save();
    refreshDevices();
    renderBindings();
  };
  dialog.querySelector("[data-device]").onchange = (e) => {
    settings.device = e.target.value;
    capture = null;
    save();
    renderBindings();
  };
  for (const name of ["axisX", "axisY", "deadzone"])
    dialog.querySelector(`[name="${name}"]`).onchange = (e) => {
      const p = selectPad(getPads());
      if (!p) return;
      settings.pads[p.id] = {
        ...padProfile(p),
        [name]: Number(e.target.value),
      };
      save();
      renderBindings();
    };
  const keydown = (e) => {
    if (e.code === "Escape") {
      capture = null;
      return;
    }
    if (capture?.kind === "key" && validCode(e.code)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const previous = Object.keys(settings.keyboard).find(
        (k) => settings.keyboard[k] === capture.action,
      );
      const displaced = settings.keyboard[e.code];
      delete settings.keyboard[previous];
      if (displaced !== undefined && displaced !== capture.action)
        settings.keyboard[previous] = displaced;
      settings.keyboard[e.code] = capture.action;
      capture = null;
      save();
      renderBindings();
    } else if (validCode(e.code) && !/INPUT|SELECT/.test(e.target.tagName)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      dialog.querySelector("[data-live]").textContent =
        `Teclado: ${keyLabel(e.code)}`;
    }
  };
  window.addEventListener("keydown", keydown, true);
  dialog.addEventListener(
    "close",
    () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", keydown, true);
      capture = null;
      dialog.remove();
      window.dispatchEvent(new Event("arena-controls-changed"));
    },
    { once: true },
  );
  const poll = () => {
    if (!dialog.open) return;
    refreshDevices();
    const p = selectPad(getPads());
    const status = dialog.querySelector("[data-device-status]");
    status.textContent = p
      ? `${p.id} · ${p.mapping === "standard" ? "Padrão reconhecido" : "Mapeamento personalizado recomendado"}`
      : navigator.getGamepads
        ? "Nenhum controle detectado. Clique nesta página e pressione um botão do controle."
        : "Este navegador não oferece a Gamepad API.";
    if (p) {
      const pressed = p.buttons.flatMap((b, i) => (b.pressed ? [i] : []));
      if (capture?.kind === "pad" && capture.id === p.id) {
        if (!pressed.length) neutral = true;
        if (neutral && pressed.length === 1) {
          const profile = {
              ...padProfile(p),
              buttons: { ...padProfile(p).buttons },
            },
            index = pressed[0];
          const old = Object.keys(profile.buttons).find(
              (k) => profile.buttons[k] === capture.action,
            ),
            displaced = profile.buttons[index];
          if (old !== undefined) delete profile.buttons[old];
          if (
            old !== undefined &&
            displaced !== undefined &&
            displaced !== capture.action
          )
            profile.buttons[old] = displaced;
          profile.buttons[index] = capture.action;
          settings.pads[p.id] = profile;
          capture = null;
          save();
          renderBindings();
        }
      }
      dialog.querySelector("[data-raw]").textContent =
        `Botões: ${pressed.map((i) => i + 1).join(", ") || "—"} · Eixos: ${p.axes.map((v) => v.toFixed(2)).join(" / ") || "—"}`;
      const labels = [...padButtons(p)].map(
        (b) => ACTIONS.find(([a]) => a === b)?.[1],
      );
      dialog.querySelector("[data-live]").textContent = labels.length
        ? labels.join(" + ")
        : capture
          ? "Aguardando o botão para mapear…"
          : "Controle em repouso";
    } else dialog.querySelector("[data-raw]").textContent = "";
    raf = requestAnimationFrame(poll);
  };
  dialog.showModal();
  window.dispatchEvent(new Event("arena-controls-changed"));
  refreshDevices();
  renderBindings();
  poll();
}
if (typeof window !== "undefined")
  window.ArenaControls = { open: openControls };
