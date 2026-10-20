// Served only by the private loopback worker server, never by public static routes.
window.createHostedWorker = function ({
  iceServers,
  bitrate = 1500000,
  maxFramerate = 60,
}) {
  const api = window.arenaEmulator,
    peers = new Map(),
    senders = new Map(),
    stream = api.stream();
  let closed = false;
  let targetBitrate = bitrate;
  let targetFramerate = maxFramerate;
  const emit = (event) => window.hostedEvent(event).catch(() => {});
  const candidates = new Map();
  // A paused canvas must still deliver its initial frame to new subscribers.
  const frameHeartbeat = setInterval(() => {
    for (const track of stream.getVideoTracks()) track.requestFrame?.();
  }, 250);

  const ladders = [
    { maxBitrate: 400000, maxFramerate: 30 },
    { maxBitrate: 800000, maxFramerate: 45 },
    { maxBitrate: 1500000, maxFramerate: 60 },
    { maxBitrate: 2500000, maxFramerate: 60 },
  ];
  let ladderIndex = ladders.findIndex((l) => l.maxBitrate >= bitrate);
  if (ladderIndex < 0) ladderIndex = 2;

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

  const lastOffers = new Map();
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
          type: "signal",
          slot,
          signal: { kind: "ice", candidate: e.candidate.toJSON() },
        });
    };
    pc.onconnectionstatechange = () =>
      emit({ type: "peer", slot, state: pc.connectionState });
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
      type: "signal",
      slot,
      signal: { kind: "offer", sdp: pc.localDescription.toJSON() },
    });
  }
  async function signal(slot, signal) {
    if (signal.kind === "viewer-ready") return offer(slot);
    const pc = peers.get(slot);
    if (!pc) throw Error("Sessão de vídeo não preparada.");
    if (signal.kind === "answer") {
      await pc.setRemoteDescription(signal.sdp);
      for (const candidate of candidates.get(slot) || [])
        await pc.addIceCandidate(candidate);
      candidates.set(slot, []);
    } else if (signal.kind === "ice") {
      if (
        !signal.candidate ||
        typeof signal.candidate.candidate !== "string" ||
        signal.candidate.candidate.length > 4096
      )
        throw Error("Candidato ICE inválido.");
      if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
      else {
        if (candidates.get(slot).length >= 64)
          throw Error("Candidatos ICE excedidos.");
        candidates.get(slot).push(signal.candidate);
      }
    } else throw Error("Mensagem de sinalização não permitida.");
  }
  async function metrics() {
    const result = [];
    for (const [slot, pc] of peers) {
      const stats = await pc.getStats();
      let bytes = 0,
        frames = 0,
        encodeSeconds = 0,
        rtt = null,
        packetsLost = 0,
        packetsSent = 0;
      for (const stat of stats.values()) {
        if (stat.type === "outbound-rtp") {
          bytes += stat.bytesSent || 0;
          frames += stat.framesEncoded || 0;
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
        framesEncoded: frames,
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
      frame: api.manager.getFrameNum(),
      peers: result,
      encoding: { maxBitrate: targetBitrate, maxFramerate: targetFramerate },
    };
  }
  return {
    signal,
    metrics,
    adaptEncodings,
    input: (slot, button, value) => {
      if (!closed) api.input(slot - 1, button, value);
    },
    pause: () => api.pause(),
    resume: () => api.resume(),
    stop: () => {
      closed = true;
      clearInterval(frameHeartbeat);
      clearInterval(adaptTimer);
      for (const pc of peers.values()) pc.close();
      for (const t of stream.getTracks()) t.stop();
      api.pause();
    },
  };
};
