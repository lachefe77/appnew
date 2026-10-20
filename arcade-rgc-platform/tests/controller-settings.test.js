import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSettings,
  padButtons,
  selectPad,
  DEFAULT_KEYS,
  DEFAULT_PAD,
} from "../public/controller-settings.js";
const pad = (id = "Controller", mapping = "standard") => ({
  id,
  mapping,
  connected: true,
  buttons: Array.from({ length: 16 }, () => ({ pressed: false })),
  axes: [0, 0],
});
test("standard Xbox/PlayStation layout maps attacks, Start and D-pad", () => {
  const p = pad();
  for (const [index, action] of Object.entries(DEFAULT_PAD)) {
    p.buttons[index].pressed = true;
    assert.deepEqual([...padButtons(p, normalizeSettings())], [action]);
    p.buttons[index].pressed = false;
  }
});
test("arcade custom profile remaps buttons and axes with bounded deadzone", () => {
  const p = pad("USB Arcade", "");
  p.axes = [0.2, -0.2, 1, -1];
  p.buttons[5].pressed = true;
  const settings = normalizeSettings({
    pads: { [p.id]: { buttons: { 5: 8 }, axisX: 2, axisY: 3, deadzone: 0.5 } },
  });
  assert.deepEqual([...padButtons(p, settings)], [8, 7, 4]);
  const bad = normalizeSettings({
    pads: {
      [p.id]: {
        axisX: -5,
        axisY: 50,
        deadzone: 100,
        buttons: { 999: 0, 1: 999, 5: 8 },
      },
    },
  }).pads[p.id];
  assert.equal(bad.deadzone, 0.9);
  assert.equal(bad.axisX, 0);
  assert.equal(bad.axisY, 1);
  assert.deepEqual(bad.buttons, { 5: 8 });
});
test("small analog movement does not press a direction and null pad is safe", () => {
  const p = pad();
  p.axes = [0.39, -0.39];
  assert.equal(padButtons(p, normalizeSettings()).size, 0);
  assert.equal(padButtons(null).size, 0);
});
test("selected disconnected device does not silently switch to another gamepad", () => {
  const a = pad("A"),
    b = pad("B");
  assert.equal(selectPad([a, b], normalizeSettings({ device: "B" })), b);
  assert.equal(selectPad([a], normalizeSettings({ device: "B" })), undefined);
  assert.equal(selectPad([a, b], normalizeSettings()), a);
});
test("incomplete or duplicate keyboard preferences restore a usable full map", () => {
  assert.deepEqual(
    normalizeSettings({ keyboard: { KeyZ: 0 } }).keyboard,
    DEFAULT_KEYS,
  );
  assert.deepEqual(
    normalizeSettings({ keyboard: { ...DEFAULT_KEYS, KeyV: 0 } }).keyboard,
    DEFAULT_KEYS,
  );
  const custom = { ...DEFAULT_KEYS, KeyV: DEFAULT_KEYS.KeyZ };
  delete custom.KeyZ;
  assert.deepEqual(normalizeSettings({ keyboard: custom }).keyboard, custom);
});
