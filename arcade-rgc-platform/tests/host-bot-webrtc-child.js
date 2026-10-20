/**
 * Child isolado: loopback wrtc. Sai com process.exit para não deixar handles nativos.
 */
import assert from "node:assert/strict";
import {
  createNativeMediaBridge,
  loadWrtc,
} from "../server/native-webrtc.js";

const wrtc = await loadWrtc();
if (!wrtc) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: "no-wrtc" }));
  process.exit(0);
}

const signals = [];
const peers = [];
const bridge = await createNativeMediaBridge({
  media: "wrtc",
  iceServers: [],
  emit: (ev) => {
    if (ev.event === "signal") signals.push(ev);
    if (ev.event === "peer") peers.push(ev);
  },
});
assert.equal(bridge.backend, "wrtc");

const pc = new wrtc.RTCPeerConnection({ iceServers: [] });
let gotTrack = false;
pc.ontrack = () => {
  gotTrack = true;
};
pc.onicecandidate = (e) => {
  if (e.candidate)
    bridge
      .signal(1, { kind: "ice", candidate: e.candidate.toJSON() })
      .catch(() => {});
};

await bridge.signal(1, { kind: "viewer-ready" });
const offerEv = signals.find((s) => s.signal?.kind === "offer");
assert.ok(offerEv, "offer");
await pc.setRemoteDescription(offerEv.signal.sdp);
await pc.setLocalDescription(await pc.createAnswer());
await bridge.signal(1, { kind: "answer", sdp: pc.localDescription.toJSON() });

const deadline = Date.now() + 5000;
while (Date.now() < deadline) {
  if (gotTrack && peers.some((p) => p.state === "connected" && p.slot === 1))
    break;
  await new Promise((r) => setTimeout(r, 40));
}
assert.ok(gotTrack, "track");
bridge.resume();
await new Promise((r) => setTimeout(r, 200));
const metrics = await bridge.metrics();
assert.equal(metrics.encoding.backend, "wrtc");

console.log(
  JSON.stringify({
    ok: true,
    gotTrack,
    peerConnected: peers.some((p) => p.state === "connected"),
    encoding: metrics.encoding,
  }),
);
process.exit(0);
