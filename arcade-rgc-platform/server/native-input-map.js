/**
 * Arena button index → ação RetroArch/FBNeo + tecla de lab.
 * Índices iguais a public/controller-settings.js (ACTIONS).
 *
 * No Host Bot real (Fase 1+), o worker traduz input Arena → teclado/joypad
 * do processo FBNeo/RetroArch. Stub só registra o mapeamento.
 */

export const ARENA_ACTIONS = Object.freeze({
  0: "punch1",
  1: "punch3",
  2: "coin",
  3: "start",
  4: "up",
  5: "down",
  6: "left",
  7: "right",
  8: "punch2",
  9: "punch4",
});

/** Teclas Windows/lab (layout QWERTY) por slot — espelha DEFAULT_KEYS do cliente. */
const KEYS_P1 = Object.freeze({
  4: "ArrowUp",
  5: "ArrowDown",
  6: "ArrowLeft",
  7: "ArrowRight",
  0: "KeyZ",
  8: "KeyX",
  1: "KeyA",
  9: "KeyS",
  3: "Enter",
  2: "Digit5",
});

/** P2: bloco numérico / teclas alternativas (sem conflito com P1). */
const KEYS_P2 = Object.freeze({
  4: "Numpad8",
  5: "Numpad2",
  6: "Numpad4",
  7: "Numpad6",
  0: "KeyU",
  8: "KeyI",
  1: "KeyJ",
  9: "KeyK",
  3: "NumpadEnter",
  2: "Digit6",
});

/** Nomes RetroArch input_playerN_* (appendconfig). */
const RETRO_BINDS = Object.freeze({
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  punch1: "b",
  punch2: "a",
  punch3: "y",
  punch4: "x",
  start: "start",
  coin: "select",
});

/**
 * Arena KeyZ/ArrowUp → nome que o RetroArch entende no .cfg
 * (não usar "KeyZ" — o RetroArch ignora e o teclado não liga).
 */
export const RETRO_KEY_NAMES = Object.freeze({
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyZ: "z",
  KeyX: "x",
  KeyA: "a",
  KeyS: "s",
  KeyU: "u",
  KeyI: "i",
  KeyJ: "j",
  KeyK: "k",
  Enter: "enter",
  NumpadEnter: "keypad enter",
  Digit5: "5",
  Digit6: "6",
  Numpad8: "keypad8",
  Numpad2: "keypad2",
  Numpad4: "keypad4",
  Numpad6: "keypad6",
});

export function arenaAction(button) {
  return ARENA_ACTIONS[Number(button)] || null;
}

export function mapArenaInput(slot, button, value) {
  const s = Number(slot) === 2 ? 2 : 1;
  const b = Number(button);
  const action = arenaAction(b);
  const keys = s === 2 ? KEYS_P2 : KEYS_P1;
  return {
    slot: s,
    button: b,
    value: value ? 1 : 0,
    action,
    key: action ? keys[b] || null : null,
    retroBind: action ? RETRO_BINDS[action] || null : null,
    retroPlayer: s,
  };
}

/** Linhas input_playerN_* para um .cfg RetroArch de lab. */
export function retroArchKeyboardLines(slot = 1) {
  const s = Number(slot) === 2 ? 2 : 1;
  const keys = s === 2 ? KEYS_P2 : KEYS_P1;
  const lines = [];
  for (const [button, action] of Object.entries(ARENA_ACTIONS)) {
    const bind = RETRO_BINDS[action];
    const arenaKey = keys[Number(button)];
    const retroKey = arenaKey ? RETRO_KEY_NAMES[arenaKey] : null;
    if (!bind || !retroKey) continue;
    lines.push(`input_player${s}_${bind} = "${retroKey}"`);
  }
  return lines;
}

export function isKnownArenaButton(button) {
  return arenaAction(button) != null;
}
