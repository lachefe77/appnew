/**
 * Bridge WebRTC nativo (Fase 2) — espelha hosted-worker.js sem Chrome.
 * Backend: @roamhq/wrtc + RTCVideoSource (frames I420 320p30).
 * Fallback lab: FSM de sinalização sem mídia real (HOST_BOT_MEDIA=lab).
 */
import { createFrameSource, NATIVE_FRAME } from "./native-frame-source.js";

export async function loadWrtc() {
  try {
    const mod = await import("@roamhq/wrtc");
    return mod.default || mod;
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   iceServers?: object[],
 *   bitrate?: number,
 *   maxFramerate?: number,
 *   emit: (ev: object) => void,
 *   media?: "wrtc"|"lab"|"auto",
 *   getFrameNum?: () => number,
 * }} opts
 */
export async function createNativeMediaBridge(opts = {}) {
  const emit = opts.emit || (() => {});
  const iceServers = opts.iceServers || [];
  const mediaMode =
    opts.media ||
    String(process.env.HOST_BOT_MEDIA || "auto").toLowerCase();
  let targetBitrate = opts.bitrate || 400000; // 320p30 leve
  let targetFramerate = opts.maxFramerate || NATIVE_FRAME.fps;
  const ladders = [
    { maxBitrate: 250000, maxFramerate: 24 },
    { maxBitrate: 400000, maxFramerate: 30 },
    { maxBitrate: 800000, maxFramerate: 30 },
    { maxBitrate: 1500000, maxFramerate: 60 },
  ];
  let ladderIndex = ladders.findIndex((l) => l.maxBitrate >= targetBitrate);
  if (ladderIndex < 0) ladderIndex = 1;

  const wrtc =
    mediaMode === "lab" ? null : await loadWrtc();
  const backend = wrtc ? "wrtc" : "lab";

  if (backend === "lab") {
    return createLabMediaBridge({
      emit,
      iceServers,
      getFrameNum: opts.getFrameNum,
      targetBitrate,
      targetFramerate,
    });
  }

  const { RTCPeerConnection, MediaStream, nonstandard } = wrtc;
  const { RTCVideoSource } = nonstandard;
  const videoSource = new RTCVideoSource();
  const videoTrack = videoSource.createTrack();
  const stream = new MediaStream([videoTrack]);

  const frameMode = String(
    opts.frameMode || process.env.HOST_BOT_FRAME_MODE || "auto",
  ).toLowerCase();
  const frames = createFrameSource({
    fps: targetFramerate,
    mode: frameMode === "external" ? "external" : frameMode === "synthetic" ? "synthetic" : "auto",
    onFrame: (f) => {
      videoSource.onFrame({
        width: f.width,
        height: f.height,
        data: f.data,
      });
    },
  });
  frames.start();

  const peers = new Map();
  const senders = new Map();
  const candidates = new Map();
  const lastOffers = new Map();
  let closed = false;

  async function applyEncoding(slot) {
    const sender = senders.get(slot);
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = targetBitrate;
    params.encodings[0].maxFramerate = targetFramerate;
    await sender.setParameters(params).catch(() => {});
  }

  async function adaptEncodings() {
    if (closed) return;
    for (const [slot, pc] of peers) {
      if (pc.connectionState !== "connected") continue;
      const stats = await pc.getStats();
      let rtt = null;
      let lost = 0;
      let sent = 0;
      for (const stat of stats.values()) {
        if (
          stat.type === "candidate-pair" &&
          stat.state === "succeeded" &&
          stat.nominated
        )
          rtt = stat.currentRoundTripTime ?? null;
        if (stat.type === "outbound-rtp" && stat.kind === "video") {
          lost += stat.packetsLost || 0;
          sent += stat.packetsSent || 0;
        }
      }
      const lossRate = sent > 20 ? lost / sent : 0;
      let next = ladderIndex;
      if ((rtt != null && rtt > 0.12) || lossRate > 0.05)
        next = Math.max(0, ladderIndex - 1);
      else if ((rtt == null || rtt < 0.05) && lossRate < 0.01)
        next = Math.min(ladders.length - 1, ladderIndex + 1);
      if (next !== ladderIndex) {
        ladderIndex = next;
        targetBitrate = ladders[ladderIndex].maxBitrate;
        targetFramerate = ladders[ladderIndex].maxFramerate;
        await applyEncoding(slot);
      }
    }
  }

  const adaptTimer = setInterval(() => {
    adaptEncodings().catch(() => {});
  }, 2500);
  if (typeof adaptTimer.unref === "function") adaptTimer.unref();

  async function offer(slot) {
    if (Date.now() - (lastOffers.get(slot) || 0) < 1000)
      throw Error("Aguarde a negociação de vídeo.");
    lastOffers.set(slot, Date.now());
    peers.get(slot)?.close();
    senders.delete(slot);
    candidates.set(slot, []);
    const pc = new RTCPeerConnection({ iceServers });
    peers.set(slot, pc);
    pc.onicecandidate = (e) => {
      if (e.candidate)
        emit({
          event: "signal",
          slot,
          signal: { kind: "ice", candidate: e.candidate.toJSON() },
        });
    };
    pc.onconnectionstatechange = () =>
      emit({ event: "peer", slot, state: pc.connectionState });
    for (const track of stream.getTracks()) {
      const sender = pc.addTrack(track, stream);
      if (track.kind === "video") {
        senders.set(slot, sender);
        const params = sender.getParameters();
        params.encodings = [
          { maxBitrate: targetBitrate, maxFramerate: targetFramerate },
        ];
        await sender.setParameters(params).catch(() => {});
      }
    }
    await pc.setLocalDescription(await pc.createOffer());
    emit({
      event: "signal",
      slot,
      signal: { kind: "offer", sdp: pc.localDescription.toJSON() },
    });
  }

  async function signal(slot, sig) {
    if (sig.kind === "viewer-ready") return offer(slot);
    const pc = peers.get(slot);
    if (!pc) throw Error("Sessão de vídeo não preparada.");
    if (sig.kind === "answer") {
      await pc.setRemoteDescription(sig.sdp);
      for (const candidate of candidates.get(slot) || [])
        await pc.addIceCandidate(candidate);
      candidates.set(slot, []);
    } else if (sig.kind === "ice") {
      if (
        !sig.candidate ||
        typeof sig.candidate.candidate !== "string" ||
        sig.candidate.candidate.length > 4096
      )
        throw Error("Candidato ICE inválido.");
      if (pc.remoteDescription) await pc.addIceCandidate(sig.candidate);
      else {
        if ((candidates.get(slot) || []).length >= 64)
          throw Error("Candidatos ICE excedidos.");
        candidates.get(slot).push(sig.candidate);
      }
    } else throw Error("Mensagem de sinalização não permitida.");
  }

  async function metrics() {
    const result = [];
    for (const [slot, pc] of peers) {
      const stats = await pc.getStats();
      let bytes = 0,
        framesEncoded = 0,
        encodeSeconds = 0,
        rtt = null,
        packetsLost = 0,
        packetsSent = 0;
      for (const stat of stats.values()) {
        if (stat.type === "outbound-rtp") {
          bytes += stat.bytesSent || 0;
          framesEncoded += stat.framesEncoded || 0;
          encodeSeconds += stat.totalEncodeTime || 0;
          packetsLost += stat.packetsLost || 0;
          packetsSent += stat.packetsSent || 0;
        }
        if (
          stat.type === "candidate-pair" &&
          stat.state === "succeeded" &&
          stat.nominated
        )
          rtt = stat.currentRoundTripTime ?? null;
      }
      result.push({
        slot,
        bytesSent: bytes,
        framesEncoded,
        totalEncodeSeconds: encodeSeconds,
        rttSeconds: rtt,
        packetsLost,
        packetsSent,
        targetBitrate,
        targetFramerate,
        state: pc.connectionState,
      });
    }
    return {
      at: Date.now(),
      frame: opts.getFrameNum?.() ?? frames.frame,
      peers: result,
      encoding: {
        maxBitrate: targetBitrate,
        maxFramerate: targetFramerate,
        width: NATIVE_FRAME.width,
        height: NATIVE_FRAME.height,
        backend,
        frameMode: frames.sourceMode,
        externalFrames: frames.externalCount,
        lastExternalAt: frames.lastExternalAt,
      },
    };
  }

  return {
    backend,
    signal,
    metrics,
    adaptEncodings,
    pause: () => frames.pause(),
    resume: () => frames.resume(),
    frameSource: frames,
    pushExternal: (raw) => frames.pushExternal(raw),
    stop: () => {
      closed = true;
      clearInterval(adaptTimer);
      frames.stop();
      for (const pc of peers.values()) {
        try {
          pc.close();
        } catch {
          /* ignore */
        }
      }
      peers.clear();
      // Não chamar track.stop() — @roamhq/wrtc pode segfault; o worker exit basta.
    },
  };
}

/** Lab sem wrtc: completa viewer-ready→offer→answer→peer connected (sem RTP). */
function createLabMediaBridge({
  emit,
  getFrameNum,
  targetBitrate,
  targetFramerate,
}) {
  const peers = new Map();
  const frames = createFrameSource({
    fps: targetFramerate,
    mode: "auto",
    onFrame: () => {},
  });
  frames.start();
  let closed = false;

  async function offer(slot) {
    peers.set(slot, { state: "connecting", offeredAt: Date.now() });
    emit({ event: "peer", slot, state: "connecting" });
    emit({
      event: "signal",
      slot,
      signal: {
        kind: "offer",
        sdp: {
          type: "offer",
          sdp: [
            "v=0",
            "o=- 0 0 IN IP4 127.0.0.1",
            "s=arena-native-lab",
            "t=0 0",
            "a=group:BUNDLE 0",
            "m=video 9 UDP/TLS/RTP/SAVPF 96",
            "c=IN IP4 0.0.0.0",
            "a=rtcp:9 IN IP4 0.0.0.0",
            "a=ice-ufrag:lab",
            "a=ice-pwd:labpasswordlabpassword",
            "a=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00",
            "a=setup:actpass",
            "a=mid:0",
            "a=sendonly",
            "a=rtcp-mux",
            "a=rtpmap:96 VP8/90000",
            "",
          ].join("\r\n"),
        },
        lab: true,
      },
    });
  }

  async function signal(slot, sig) {
    if (sig.kind === "viewer-ready") return offer(slot);
    if (!peers.has(slot)) throw Error("Sessão de vídeo não preparada.");
    if (sig.kind === "answer") {
      peers.set(slot, { state: "connected", answeredAt: Date.now() });
      emit({ event: "peer", slot, state: "connected" });
    } else if (sig.kind === "ice") {
      /* lab ignora ICE */
    } else throw Error("Mensagem de sinalização não permitida.");
  }

  async function metrics() {
    return {
      at: Date.now(),
      frame: getFrameNum?.() ?? frames.frame,
      peers: [...peers.entries()].map(([slot, p]) => ({
        slot,
        bytesSent: frames.frame * 1200,
        framesEncoded: frames.frame,
        totalEncodeSeconds: frames.frame / 30,
        rttSeconds: 0.02,
        packetsLost: 0,
        packetsSent: frames.frame,
        targetBitrate,
        targetFramerate,
        state: p.state,
      })),
      encoding: {
        maxBitrate: targetBitrate,
        maxFramerate: targetFramerate,
        width: NATIVE_FRAME.width,
        height: NATIVE_FRAME.height,
        backend: "lab",
        frameMode: frames.sourceMode,
        externalFrames: frames.externalCount,
        lastExternalAt: frames.lastExternalAt,
      },
    };
  }

  return {
    backend: "lab",
    signal,
    metrics,
    adaptEncodings: async () => {},
    pause: () => frames.pause(),
    resume: () => frames.resume(),
    frameSource: frames,
    pushExternal: (raw) => frames.pushExternal(raw),
    stop: () => {
      closed = true;
      frames.stop();
      peers.clear();
    },
  };
}
