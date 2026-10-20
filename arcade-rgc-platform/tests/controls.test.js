import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = {};
globalThis.document = { getElementById: () => null };
globalThis.WebSocket = { OPEN: 1 };
const { FBNeoLoader } = await import("../public/fbneo-loader.js");

function session(hosted = true) {
  const loader = new FBNeoLoader();
  const sent = [];
  Object.assign(loader, {
    running: true,
    hosted,
    inputSeq: 0,
    inputEpoch: "test",
    pendingInputs: new Map(),
    ws: { readyState: 1, send: (text) => sent.push(JSON.parse(text)) },
  });
  return { loader, sent };
}
const transitions = (sent) => sent.map(({ button, value }) => [button, value]);

test("received video stats report interval loss and decoded FPS without changing match or wallet", async () => {
  const { loader, sent } = session();
  loader.qualityEl = { textContent: "" };
  let sample = {
    type: "inbound-rtp",
    kind: "video",
    timestamp: 1000,
    framesDecoded: 0,
    packetsReceived: 0,
    packetsLost: 0,
    jitter: 0.01,
  };
  loader.pc = { getStats: async () => new Map([["video", sample]]) };
  await loader.sampleMedia();
  sample = {
    ...sample,
    timestamp: 3000,
    framesDecoded: 120,
    packetsReceived: 90,
    packetsLost: 10,
  };
  await loader.sampleMedia();
  assert.match(loader.qualityEl.textContent, /60 FPS/);
  assert.match(loader.qualityEl.textContent, /10.0%/);
  assert.match(loader.qualityEl.textContent, /Jitter: 10 ms/);
  loader.lastVideoFrameAt = Date.now() - 6000;
  sample = { ...sample, timestamp: 5000 };
  await loader.sampleMedia();
  assert.match(loader.qualityEl.textContent, /Sem novos quadros/);
  assert.equal(sent.length, 0);
});

test("hosted coin (Y/FICHA) is sent so Neo Geo can take CREDIT", () => {
  const { loader, sent } = session();
  loader.input(2, 1, "key:KeyY");
  loader.input(2, 0, "key:KeyY");
  assert.deepEqual(transitions(sent), [
    [2, 1],
    [2, 0],
  ]);
  assert.equal(loader.inputSeq, 2);
});

test("local friendly still permits coin and release", () => {
  const { loader, sent } = session(false);
  loader.input(2, 1);
  loader.input(2, 0);
  assert.deepEqual(transitions(sent), [
    [2, 1],
    [2, 0],
  ]);
});

test("keyboard release preserves a button still held on the gamepad", () => {
  const { loader, sent } = session();
  loader.input(0, 1, "key:KeyZ");
  loader.input(0, 1, "pad:0");
  loader.input(0, 0, "key:KeyZ");
  assert.deepEqual(transitions(sent), [[0, 1]]);
  loader.input(0, 0, "pad:0");
  assert.deepEqual(transitions(sent), [
    [0, 1],
    [0, 0],
  ]);
});

test("opposite directions release before pressing and restore a held direction", () => {
  const { loader, sent } = session();
  loader.input(6, 1, "key:ArrowLeft");
  loader.input(7, 1, "key:ArrowRight");
  loader.input(7, 0, "key:ArrowRight");
  assert.deepEqual(transitions(sent), [
    [6, 1],
    [6, 0],
    [7, 1],
    [7, 0],
    [6, 1],
  ]);
  loader.releaseAll();
  assert.deepEqual(transitions(sent).at(-1), [6, 0]);
  assert.equal(loader.inputSources.size, 0);
});

test("disconnected input cannot advance sequence or retain pressed sources", () => {
  const { loader, sent } = session();
  loader.ws.readyState = 3;
  loader.input(0, 1);
  assert.equal(loader.inputSeq, 0);
  assert.equal(loader.inputSources.size, 0);
  assert.equal(sent.length, 0);
});

test("keyboard maps four attacks to ZXAS, ignores text editing and repeated keydown", () => {
  const { loader, sent } = session();
  const handlers = {};
  loader._bindKeys({ addEventListener: (name, fn) => (handlers[name] = fn) });
  const event = (code) => ({
    code,
    target: { tagName: "BODY" },
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  for (const code of ["KeyZ", "KeyX", "KeyA", "KeyS"]) {
    handlers.keydown(event(code));
    handlers.keydown({ ...event(code), repeat: true });
    handlers.keyup(event(code));
  }
  assert.deepEqual(transitions(sent), [
    [0, 1],
    [0, 0],
    [8, 1],
    [8, 0],
    [1, 1],
    [1, 0],
    [9, 1],
    [9, 0],
  ]);
  handlers.keydown({ ...event("KeyZ"), target: { tagName: "INPUT" } });
  handlers.keydown({
    ...event("KeyZ"),
    target: { tagName: "DIV", isContentEditable: true },
  });
  handlers.keydown(event("KeyD"));
  assert.equal(sent.length, 8);
  handlers.keydown(event("ArrowUp"));
  handlers.blur();
  handlers.keyup(event("ArrowUp"));
  assert.deepEqual(transitions(sent).slice(-2), [
    [4, 1],
    [4, 0],
  ]);
});

test("the published rule allowlist also filters otherwise valid buttons", () => {
  const { loader, sent } = session();
  loader.players = { rules: { allowedButtons: [0, 3] } };
  loader.input(8, 1);
  loader.input(8, 0);
  loader.input(0, 1);
  assert.deepEqual(transitions(sent), [[0, 1]]);
  assert.equal(loader.inputSeq, 1);
});
