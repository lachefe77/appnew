// Served only by the private loopback worker server, never by public static routes.
window.createHostedWorker = function ({ iceServers, bitrate = 1500000 }) {
  const api = window.arenaEmulator,
    peers = new Map(),
    stream = api.stream();
  let closed = false;
  const emit = (event) => window.hostedEvent(event).catch(() => {});
  const candidates = new Map();
  // A paused canvas must still deliver its initial frame to new subscribers.
  const frameHeartbeat = setInterval(() => {
    for (const track of stream.getVideoTracks()) track.requestFrame?.();
  }, 250);
  const lastOffers = new Map();
  async function offer(slot) {
    if (Date.now() - (lastOffers.get(slot) || 0) < 1000)
      throw Error("Aguarde a negociação de vídeo.");
    lastOffers.set(slot, Date.now());
    peers.get(slot)?.close();
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
        const params = sender.getParameters();
        params.encodings = [{ maxBitrate: bitrate, maxFramerate: 60 }];
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
        rtt = null;
      for (const stat of stats.values()) {
        if (stat.type === "outbound-rtp") {
          bytes += stat.bytesSent || 0;
          frames += stat.framesEncoded || 0;
          encodeSeconds += stat.totalEncodeTime || 0;
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
        state: pc.connectionState,
      });
    }
    return { at: Date.now(), frame: api.manager.getFrameNum(), peers: result };
  }
  return {
    signal,
    metrics,
    input: (slot, button, value) => {
      if (!closed) api.input(slot - 1, button, value);
    },
    pause: () => api.pause(),
    resume: () => api.resume(),
    stop: () => {
      closed = true;
      clearInterval(frameHeartbeat);
      for (const pc of peers.values()) pc.close();
      for (const t of stream.getTracks()) t.stop();
      api.pause();
    },
  };
};
