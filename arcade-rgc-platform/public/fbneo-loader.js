// One FBNeo session, two controllers. Video/audio use WebRTC; control and
// signaling messages are authorized by the platform WebSocket server.
import {
  getSettings,
  getPads,
  selectPad,
  padButtons,
  isConfiguring,
  openControls,
  keyLabel,
} from "./controller-settings.js";
export class FBNeoLoader {
  constructor(containerId = "arenaCanvasWrapper") {
    this.container = document.getElementById(containerId);
    this.frame = null;
    this.pc = null;
    this.keys = new Set();
    this.pressed = new Set();
    this.inputSources = new Map();
    this.ready = false;
    this.running = false;
    this.stopped = false;
    this.signalChain = Promise.resolve();
    this.candidates = [];
    this.gamepadButtons = new Set();
    this.focused = true;
  }
  send(type, extra = {}) {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ type, matchId: this.matchId, ...extra }));
  }
  status(message) {
    if (this.statusEl) this.statusEl.textContent = message;
  }
  loading(stage = "assets", detail) {
    const stages = {
      assets: 0,
      runtime: 1,
      boot: 1,
      credits: 1,
      ready: 2,
      negotiating: 2,
      video: 3,
      running: 4,
    };
    const labels = [
      "Conferindo arquivos do jogo",
      "Preparando o emulador",
      "Conectando o vídeo",
      "Aguardando os dois jogadores",
    ];
    this.loadStage = stages[stage] ?? this.loadStage ?? 0;
    if (!this.loadingEl) return;
    this.loadingEl.hidden = false;
    this.loadingEl.querySelector("h2").textContent =
      this.loadStage === 4
        ? "Aguardando imagem do jogo"
        : labels[this.loadStage];
    this.loadingEl.querySelector("[data-loading-detail]").textContent =
      detail ||
      "A partida só começa quando os dois jogadores estiverem prontos.";
    this.loadingEl.querySelectorAll("li").forEach((item, i) => {
      item.dataset.state =
        i < this.loadStage
          ? "done"
          : i === this.loadStage
            ? "active"
            : "pending";
      item.setAttribute(
        "aria-current",
        i === this.loadStage ? "step" : "false",
      );
    });
    this.maybeShowGame();
  }
  maybeShowGame() {
    if (this.loadingEl && this.running && this.ready)
      this.loadingEl.hidden = true;
  }
  async launch(_rom, opts = {}) {
    this.ws = opts.ws;
    this.matchId = opts.matchId;
    this.slot = opts.localSlot || 1;
    this.players = opts.players;
    this.hosted = opts.players?.transport === "server-stream";
    this.inputEpoch = opts.players?.inputEpoch;
    this.inputSeq = (opts.players?.nextInputSeq || 1) - 1;
    this.remoteSequences = new Map();
    this.pendingInputs = new Map();
    this.stopped = false;
    if (!this.container) throw Error("Área do jogo não encontrada.");
    this.container.replaceChildren();
    this.container.style.cssText =
      "width:100%;height:100%;min-height:420px;background:#080c16;display:flex;flex-direction:column;";
    const toolbar = document.createElement("div");
    toolbar.className = "game-toolbar";
    toolbar.style.cssText =
      "display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px;background:#121b2c;font:13px system-ui;color:white;";
    this.statusEl = document.createElement("span");
    this.statusEl.style.flex = "1";
    toolbar.append(this.statusEl);
    const button = (label, handler) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText =
        "background:#00d4ec;border:0;border-radius:4px;padding:7px;color:#08151c;font-weight:bold;cursor:pointer";
      b.onclick = handler;
      toolbar.append(b);
      return b;
    };
    const coinButton = button("FICHA (Y)", () => {
      this.focused = true;
      this.pulse(2);
      this.status(
        `P${this.slot}: ficha enviada. Olha CREDIT no RetroArch (não spamar — 1× basta).`,
      );
    });
    coinButton.disabled = false;
    coinButton.title = this.hosted
      ? "1 ficha (Y). Servidor já mete 2 ao iniciar. Não spamar — reinicia o attract."
      : "Inserir ficha (Y)";
    const startButton = button("START", () => {
      this.focused = true;
      this.pulse(3);
      this.status(
        `P${this.slot}: START. Se CREDIT > 0, escolhe personagem. Os dois apertam START.`,
      );
    });
    startButton.title = "Enter / START — só depois do CREDIT subir";
    button("CONTROLES", () => {
      this.releaseAll();
      openControls();
    });
    button("TELA CHEIA", () => {
      const target =
        this.container.closest(".arena-game-modal") || this.container;
      (document.fullscreenElement
        ? document.exitFullscreen()
        : target.requestFullscreen?.()
      )?.catch(() => this.status("O navegador não permitiu a tela cheia."));
    });
    this.winButton = button("VENCI", () =>
      this.report(this.players?.[this.slot === 1 ? "playerA" : "playerB"]?.id),
    );
    this.lossButton = button("PERDI", () =>
      this.report(this.players?.[this.slot === 1 ? "playerB" : "playerA"]?.id),
    );
    this.winButton.disabled = true;
    this.lossButton.disabled = true;
    if (this.hosted) {
      this.winButton.remove();
      this.lossButton.remove();
    }
    button("CANCELAR / DISPUTAR", () => {
      if (
        confirm(
          "Encerrar e abrir análise? Após o início, as reservas ficam preservadas até decisão ou prazo de revisão.",
        )
      )
        this.send("DISPUTE_MATCH");
    });
    this.container.append(toolbar);
    const rules = document.createElement("div");
    rules.style.cssText = "padding:6px;color:#b7c8dd;font:12px system-ui";
    rules.textContent = `Regras v${this.players?.rules?.version || 1} • Créditos de teste • Após início: revisão, sem estorno imediato • ${this.hosted ? "Execução oficial no servidor; resultado coletado pela sessão." : "Resultado confirmado pelos jogadores."}`;
    this.container.append(rules);
    if (this.hosted) {
      this.metricsEl = document.createElement("div");
      this.metricsEl.style.cssText =
        "padding:5px;color:#a9bad4;font:12px system-ui";
      this.metricsEl.textContent =
        "Métricas da execução oficial serão medidas após conectar.";
      this.container.append(this.metricsEl);
      this.qualityEl = document.createElement("div");
      this.qualityEl.className = "game-media-quality";
      this.qualityEl.textContent = "Qualidade recebida: aguardando vídeo.";
      this.container.append(this.qualityEl);
      this.mediaTimer = setInterval(
        () => this.sampleMedia().catch(() => {}),
        2000,
      );
    }
    this.stageEl = document.createElement("div");
    this.stageEl.className = "game-stage";
    this.container.append(this.stageEl);
    this.loadingEl = document.createElement("div");
    this.loadingEl.className = "game-loading";
    this.loadingEl.setAttribute("role", "status");
    this.loadingEl.innerHTML = `<div class="game-loading-card"><span class="portal-eyebrow">PREPARANDO SUA PARTIDA</span><div class="loading-spinner" aria-hidden="true"></div><h2></h2><p data-loading-detail></p><ol><li>Arquivos do jogo</li><li>Emulador</li><li>Conexão de vídeo</li><li>Prontidão dos jogadores</li></ol><div class="loading-track" aria-hidden="true"><span></span></div><small data-loading-time></small><p class="loading-note">Mantenha as duas janelas abertas. Não é necessário inserir ficha no modo servidor.</p></div>`;
    this.stageEl.append(this.loadingEl);
    this.loadStarted = Date.now();
    this.loading(
      "assets",
      this.hosted
        ? "Aguardando a preparação oficial no servidor."
        : "Selecione ROM e BIOS na janela do emulador.",
    );
    this.loadingTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - this.loadStarted) / 1000);
      this.loadingEl.querySelector("[data-loading-time]").textContent =
        `${seconds}s de preparação${seconds >= 30 ? " · Está demorando mais que o normal. Verifique se o outro jogador continua conectado; se aparecer uma falha, consulte a revisão da partida." : ""}`;
    }, 1000);
    this._peer();
    if (this.slot === 1 && !this.hosted) {
      this.status("P1: selecione ROM e BIOS para iniciar.");
      this.frame = document.createElement("iframe");
      this.frame.src = "/emulator.html";
      this.frame.title = "KOF 2002 — jogador 1";
      this.frame.style.cssText = "border:0;width:100%;flex:1;min-height:360px";
      this.frame.allow = "autoplay; gamepad";
      this.stageEl.append(this.frame);
      // Local setup must remain reachable under the loader.
      this.loadingEl.hidden = true;
      this.messageHandler = (e) => {
        if (
          e.origin !== location.origin ||
          e.source !== this.frame.contentWindow ||
          e.data?.source !== "arena-emulator"
        )
          return;
        if (e.data.type === "ready") {
          this.ready = true;
          this.status("KOF carregado. Conectando jogador 2…");
          this._connectHost().catch((e) => this.failure(e.message));
          this.send("GAME_READY");
          this._bindKeys(this.frame.contentWindow);
        } else if (e.data.type === "error") this.failure(e.data.message);
        else if (e.data.type === "status") {
          this.status(e.data.message);
          this.send("MATCH_SIGNAL", {
            signal: {
              kind: "preflight-status",
              message: String(e.data.message).slice(0, 500),
            },
          });
        }
      };
      window.addEventListener("message", this.messageHandler);
    } else {
      this.status(
        this.hosted
          ? "Aguardando o servidor preparar a execução oficial…"
          : "P2: aguardando o jogador 1 carregar KOF e BIOS…",
      );
      this.video = document.createElement("video");
      this.video.autoplay = true;
      this.video.playsInline = true;
      // WebRTC lab = vídeo; som sai da janela RetroArch (audio_enable=true).
      this.video.muted = true;
      this.video.tabIndex = 0;
      this.video.style.cssText =
        "width:100%;flex:1;min-height:300px;max-height:65vh;object-fit:contain;background:black;outline:none";
      this.video.title = "Clique aqui e use o teclado (Y=ficha, Enter=START, setas, Z/X/A/S)";
      this.video.addEventListener("click", () => {
        this.focused = true;
        this.video.focus();
        this.status(
          `P${this.slot} foco no jogo. Y=ficha · Enter=START · setas · Z/X/A/S. Som na janela RetroArch.`,
        );
      });
      this.stageEl.append(this.video);
      button("NITIDEZ", () => {
        this.video.classList.toggle("pixel-video");
      });
      button("SOM (RA)", () => {
        this.video.muted = false;
        this.video.play().catch(() => {});
        this.status(
          "Som do combate: na janela RetroArch (não mute o Windows). WebRTC é só vídeo neste lab.",
        );
      });
      this.video.onloadeddata = () => {
        if (!this.ready) {
          this.ready = true;
          this.send("GAME_READY");
          this.status("Imagem recebida. Aguardando liberação da partida…");
          this.loading(
            "video",
            "Imagem recebida. Aguardando a prontidão do outro jogador.",
          );
        }
      };
      if (!this.hosted)
        this.send("MATCH_SIGNAL", { signal: { kind: "viewer-ready" } });
    }
    const help = document.createElement("div");
    const updateHelp = () => {
      const keys = getSettings().keyboard;
      const label = (action) =>
        keyLabel(Object.keys(keys).find((k) => keys[k] === action) || "—");
      help.textContent =
        `Controles: ${[4, 5, 6, 7].map(label).join(" ")} = movimento • ${[0, 8, 1, 9].map(label).join(" ")} = golpes • ${label(3)} = Start • ${label(2)} = Ficha. ` +
        (this.hosted
          ? "Clique no vídeo → teclar. 1× FICHA se CREDIT=0; depois START. Desliga overlay Discord no RetroArch. Som = janela RA."
          : "Amistoso local: ambos confirmam VENCI/PERDI.");
    };
    updateHelp();
    help.style.cssText = "padding:7px;color:#a9bad4;font:12px system-ui";
    this.container.append(help);
    this._bindKeys(window);
    const preferencesChanged = () => {
      this.releaseAll();
      updateHelp();
    };
    window.addEventListener("arena-controls-changed", preferencesChanged);
    this.listeners ??= [];
    this.listeners.push(() =>
      window.removeEventListener("arena-controls-changed", preferencesChanged),
    );
    this._padLoop();
    return this;
  }
  _peer(iceServers) {
    this.pc?.close();
    this.receivedVideo = null;
    this.lastVideoFrameAt = Date.now();
    this.candidates = [];
    const servers =
      iceServers?.length > 0
        ? iceServers
        : this.iceServers?.length > 0
          ? this.iceServers
          : [{ urls: "stun:stun.l.google.com:19302" }];
    this.iceServers = servers;
    this.pc = new RTCPeerConnection({
      iceServers: servers,
    });
    this.pc.onicecandidate = (e) => {
      if (e.candidate)
        this.send("MATCH_SIGNAL", {
          signal: { kind: "ice", candidate: e.candidate.toJSON() },
        });
    };
    this.pc.ontrack = (e) => {
      this.loading(
        "negotiating",
        "Canal de vídeo encontrado. Recebendo o primeiro quadro…",
      );
      if (this.video) {
        this.video.srcObject = e.streams[0] || new MediaStream([e.track]);
        this.video
          .play()
          .catch(() =>
            this.status("Clique na imagem para iniciar a reprodução."),
          );
        this.video.onclick = () => this.video.play();
      }
    };
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === "connecting")
        this.loading(
          "negotiating",
          "Negociando a conexão de vídeo com o servidor.",
        );
      if (this.pc.connectionState === "failed")
        this.failure(
          "Conexão de vídeo falhou. Tente novamente; redes externas podem precisar de TURN.",
        );
    };
  }
  async _connectHost() {
    if (this.stopped || !this.ready || this.slot !== 1) return;
    for (const track of this.stream?.getTracks() || []) track.stop();
    this._peer();
    const api = this.frame.contentWindow.arenaEmulator,
      canvas = api.canvas();
    if (!canvas) throw Error("Canvas do KOF não encontrado.");
    this.stream = api.stream?.() || canvas.captureStream(60);
    // EmulatorJS mixes audio through WebAudio. Capture only when the core exposes it.
    try {
      const ctx = api.manager.Module.AL?.currentCtx;
      if (!this.stream.getAudioTracks().length && ctx?.audioCtx) {
        const destination = ctx.audioCtx.createMediaStreamDestination();
        for (const source of Object.values(ctx.sources || {}))
          source.gain?.connect(destination);
        for (const t of destination.stream.getAudioTracks())
          this.stream.addTrack(t);
      }
    } catch {}
    for (const track of this.stream.getTracks())
      this.pc.addTrack(track, this.stream);
    await this.pc.setLocalDescription(await this.pc.createOffer());
    this.send("MATCH_SIGNAL", {
      signal: { kind: "offer", sdp: this.pc.localDescription.toJSON() },
    });
  }
  receiveSignal(signal) {
    this.signalChain = this.signalChain
      .then(async () => {
        if (this.stopped) return;
        if (signal.kind === "preflight-status" && this.slot === 2) {
          this.status("Jogador 1: " + String(signal.message).slice(0, 500));
          return;
        }
        if (signal.kind === "viewer-ready") {
          if (this.slot === 1 && this.ready) this.scheduleHost();
          return;
        }
        if (signal.kind === "offer" && (this.slot === 2 || this.hosted)) {
          await this.pc.setRemoteDescription(signal.sdp);
          for (const c of this.candidates) await this.pc.addIceCandidate(c);
          this.candidates = [];
          await this.pc.setLocalDescription(await this.pc.createAnswer());
          this.send("MATCH_SIGNAL", {
            signal: { kind: "answer", sdp: this.pc.localDescription.toJSON() },
          });
        } else if (signal.kind === "answer" && this.slot === 1) {
          await this.pc.setRemoteDescription(signal.sdp);
          for (const c of this.candidates) await this.pc.addIceCandidate(c);
          this.candidates = [];
        } else if (signal.kind === "ice") {
          if (this.pc.remoteDescription)
            await this.pc.addIceCandidate(signal.candidate);
          else this.candidates.push(signal.candidate);
        }
      })
      .catch((e) => this.failure("Falha na negociação: " + e.message));
    return this.signalChain;
  }
  setRunning() {
    this.running = true;
    this.allowResult = true;
    if (!this.reported && !this.hosted) {
      this.winButton.disabled = false;
      this.lossButton.disabled = false;
    }
    this.status(
      `P${this.slot} conectado. ${this.hosted ? "Jogo no servidor. Y ou FICHA = crédito; depois START." : "Y ou FICHA = crédito; depois START."} Créditos de demonstração.`,
    );
    this.frame?.contentWindow.arenaEmulator?.resume();
    this.maybeShowGame();
  }
  peerDisconnected() {
    this.releaseAll();
    if (this.slot === 1)
      for (let b = 0; b < 16; b++)
        this.frame?.contentWindow.arenaEmulator?.input(1, b, 0);
    this.running = false;
    this.loading(
      "negotiating",
      "Conexão interrompida. Aguardando o retorno do jogador; reservas preservadas.",
    );
    this.frame?.contentWindow.arenaEmulator?.pause();
    this.status(
      "Conexão interrompida. Aguardando reconexão; reservas preservadas.",
    );
  }
  scheduleHost() {
    clearTimeout(this.offerTimer);
    this.offerTimer = setTimeout(
      () => this._connectHost().catch((e) => this.failure(e.message)),
      200,
    );
  }
  async resume(ws, session) {
    this.ws = ws;
    if (session) {
      this.inputEpoch = session.inputEpoch;
      this.inputSeq = (session.nextInputSeq || 1) - 1;
      this.pressed.clear();
      this.inputSources.clear();
      this.gamepadButtons.clear();
    }
    if (this.hosted) {
      this._peer();
      this.onHostedReady();
      return;
    }
    if (this.slot === 1 && !this.ready) {
      this.failure(
        "A sessão do emulador foi perdida ao recarregar a página. O encerramento seguirá as regras da fase da partida.",
      );
      return;
    }
    if (this.slot === 2) {
      this._peer();
      this.send("MATCH_SIGNAL", { signal: { kind: "viewer-ready" } });
    } else if (this.ready) this.scheduleHost();
  }
  onRemoteInput(button, value, slot = 2, epoch, seq) {
    if (this.slot !== 1 || !this.ready || ![1, 2].includes(slot)) return;
    const key = slot + ":" + epoch;
    if (
      !Number.isSafeInteger(seq) ||
      seq <= (this.remoteSequences.get(key) || 0)
    )
      return;
    this.remoteSequences.set(key, seq);
    this.frame?.contentWindow.arenaEmulator?.input(slot - 1, button, value);
  }
  input(button, value, source = `direct:${button}`) {
    if (!this.running || this.stopped || this.ws?.readyState !== WebSocket.OPEN)
      return;
    const allowed = this.players?.rules?.allowedButtons;
    // Ficha (2) liberada no hosted — Neo Geo CREDIT via Y / botão FICHA.
    if (allowed && !allowed.includes(button)) return;
    if (value) {
      if (this.inputSources.has(source)) return;
      this.inputSources.set(source, button);
    } else {
      if (!this.inputSources.delete(source)) return;
    }
    const opposite = { 4: 5, 5: 4, 6: 7, 7: 6 };
    const desired = new Set();
    // Later physical presses take priority over an opposite direction. When
    // released, a direction still held by another source becomes active again.
    for (const b of this.inputSources.values()) {
      desired.delete(opposite[b]);
      desired.add(b);
    }
    for (const b of [...this.pressed])
      if (!desired.has(b)) this.sendInput(b, 0);
    for (const b of desired) if (!this.pressed.has(b)) this.sendInput(b, 1);
  }
  sendInput(button, value) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const clientSentAt = performance.now();
    if (this.hosted) {
      this.pendingInputs.set(this.inputSeq + 1, clientSentAt);
      if (this.pendingInputs.size > 256)
        this.pendingInputs.delete(this.pendingInputs.keys().next().value);
    }
    this.send("PLAYER_INPUT", {
      button,
      value,
      epoch: this.inputEpoch,
      seq: ++this.inputSeq,
      clientSentAt,
    });
    if (value) this.pressed.add(button);
    else this.pressed.delete(button);
  }
  pulse(button) {
    const source = Symbol("toolbar");
    this.input(button, 1, source);
    setTimeout(() => this.input(button, 0, source), 100);
  }
  _bindKeys(target) {
    // F1–F12 nunca devem chegar ao Chrome (Help / novas abas).
    const isFunctionKey = (code) => /^F([1-9]|1[0-2])$/.test(code);
    const down = (e) => {
      if (isConfiguring()) return;
      if (
        this.running &&
        (isFunctionKey(e.code) || e.key === "F1" || /^F\d+$/.test(e.key || ""))
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        // F1/F2 no browser NÃO são ficha — ficha é Y / botão. Ignora.
        return;
      }
      const b = getSettings().keyboard[e.code];
      if (
        b === undefined ||
        /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName) ||
        e.target?.isContentEditable
      )
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) this.input(b, 1, `key:${e.code}`);
    };
    const up = (e) => {
      if (isConfiguring()) return;
      if (this.running && isFunctionKey(e.code)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      const b = getSettings().keyboard[e.code];
      if (b !== undefined) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.input(b, 0, `key:${e.code}`);
      }
    };
    const blur = () => {
      // Hosted: o host foca o RetroArch para SendInput — não soltar teclas
      // nem assustar com "sem foco" (senão START/controlos parecem mortos).
      if (this.hosted) {
        this.focused = true;
        return;
      }
      this.focused = false;
      this.releaseAll();
      this.status("Janela sem foco. Clique no jogo para voltar a controlar.");
    };
    const focus = () => {
      this.focused = true;
      if (this.running)
        this.status(
          this.hosted
            ? `P${this.slot} conectado. Jogo no servidor. Fichas no gabinete — pressione START.`
            : `P${this.slot} conectado. Enter = Start. CONTROLES permite testar e remapear.`,
        );
    };
    const onVisibility = () => {
      if (typeof document !== "undefined" && document.hidden) {
        this.focused = false;
        this.releaseAll();
        this.status("Aba oculta — comandos liberados (anti stuck-button).");
      }
    };
    const onPageHide = () => this.releaseAll();
    target.addEventListener("keydown", down, true);
    target.addEventListener("keyup", up, true);
    target.addEventListener("blur", blur);
    target.addEventListener("focus", focus);
    const doc =
      typeof document !== "undefined" && document?.addEventListener
        ? document
        : null;
    const win =
      typeof window !== "undefined" && window?.addEventListener ? window : null;
    doc?.addEventListener("visibilitychange", onVisibility);
    win?.addEventListener("pagehide", onPageHide);
    this.listeners ??= [];
    this.listeners.push(() => {
      target.removeEventListener("keydown", down, true);
      target.removeEventListener("keyup", up, true);
      target.removeEventListener("blur", blur);
      target.removeEventListener("focus", focus);
      doc?.removeEventListener("visibilitychange", onVisibility);
      win?.removeEventListener("pagehide", onPageHide);
    });
  }
  _padLoop() {
    if (this.stopped) return;
    const pad = selectPad(getPads());
    const current =
      this.running && this.focused && !isConfiguring()
        ? padButtons(pad)
        : new Set();
    for (const b of current)
      if (!this.gamepadButtons.has(b)) this.input(b, 1, `pad:${b}`);
    for (const b of this.gamepadButtons)
      if (!current.has(b)) this.input(b, 0, `pad:${b}`);
    this.gamepadButtons = current;
    this.padTimer = requestAnimationFrame(() => this._padLoop());
  }
  releaseAll() {
    for (const b of [...this.pressed]) {
      this.sendInput(b, 0);
    }
    this.pressed.clear();
    this.inputSources.clear();
    this.gamepadButtons.clear();
  }
  report(winnerId) {
    if (this.hosted) return;
    if (!this.allowResult || this.stopped || !winnerId) return;
    if (
      confirm(
        "Confirma o resultado que aparece no KOF? Os dois jogadores precisam informar o mesmo vencedor.",
      )
    ) {
      this.reported = true;
      this.send("REPORT_MATCH_RESULT", { winnerId });
      this.winButton.disabled = true;
      this.lossButton.disabled = true;
      this.status("Resultado enviado. Aguardando a confirmação do adversário.");
    }
  }
  resultPending(message) {
    this.releaseAll();
    this.running = false;
    this.frame?.contentWindow.arenaEmulator?.pause();
    this.status(message);
  }
  onHostedReady(msg) {
    if (msg?.iceServers?.length) this.iceServers = msg.iceServers;
    this._peer(this.iceServers);
    this.loading(
      "ready",
      "Emulador preparado. Conectando os jogadores ao vídeo oficial.",
    );
    this.send("MATCH_SIGNAL", { signal: { kind: "viewer-ready" } });
  }
  onInputAck(message) {
    const sent = this.pendingInputs.get(message.seq);
    if (sent !== undefined) {
      this.lastAckMs = Math.round(performance.now() - sent);
      this.pendingInputs.delete(message.seq);
    }
    // Latência comando→imagem: ecoa clientSentAt e marca o próximo frame decodificado.
    const clientSentAt = message.clientSentAt ?? sent;
    if (clientSentAt != null && this.video) {
      const mark = () => {
        const frameDecodedAt = performance.now();
        this.send("LATENCY_SAMPLE", {
          clientSentAt,
          acceptedAt: message.acceptedAt,
          frameDecodedAt,
          seq: message.seq,
        });
        this.lastCmdImageMs = Math.round(frameDecodedAt - clientSentAt);
      };
      if (typeof this.video.requestVideoFrameCallback === "function")
        this.video.requestVideoFrameCallback(() => mark());
      else requestAnimationFrame(() => mark());
    }
  }
  onHostedMetrics(metrics) {
    const peers = Array.isArray(metrics.peers)
      ? metrics.peers
      : Object.values(metrics.peers || {});
    const peer = peers.find((p) => p.slot === this.slot),
      previousPeers = Array.isArray(this.metrics?.peers)
        ? this.metrics.peers
        : Object.values(this.metrics?.peers || {}),
      previous = previousPeers.find((p) => p.slot === this.slot);
    let rate = "medindo";
    if (peer && previous) {
      const elapsed = (metrics.at - this.metrics.at) / 1000;
      if (elapsed > 0)
        rate =
          (
            ((peer.bytesSent - previous.bytesSent) * 8) /
            elapsed /
            1000000
          ).toFixed(2) + " Mbps";
    }
    this.metrics = metrics;
    const cmdImg =
      this.lastCmdImageMs ?? metrics.commandLatency?.last ?? null;
    if (this.metricsEl)
      this.metricsEl.textContent = `Vídeo: ${peer?.state || "conectando"} • Envio: ${rate} • RTT de mídia: ${peer?.rttSeconds != null ? Math.round(peer.rttSeconds * 1000) + " ms" : metrics.rttMs != null ? metrics.rttMs + " ms" : "medindo"} • Comando confirmado: ${this.lastAckMs ?? "—"} ms • cmd→img: ${cmdImg ?? "—"} ms • Quadro do core: ${metrics.frame}.`;
  }
  async sampleMedia() {
    if (this.mediaSampling || this.stopped || !this.pc || !this.qualityEl)
      return;
    this.mediaSampling = true;
    try {
      const stats = await this.pc.getStats();
      if (this.stopped) return;
      const video = [...stats.values()].find(
        (s) =>
          s.type === "inbound-rtp" &&
          (s.kind === "video" || s.mediaType === "video"),
      );
      if (!video) return;
      const previous = this.receivedVideo,
        seconds = previous ? (video.timestamp - previous.timestamp) / 1000 : 0;
      const frames = Math.max(
        0,
        (video.framesDecoded || 0) - (previous?.framesDecoded || 0),
      );
      const received = Math.max(
        0,
        (video.packetsReceived || 0) - (previous?.packetsReceived || 0),
      );
      const lost = Math.max(
        0,
        (video.packetsLost || 0) - (previous?.packetsLost || 0),
      );
      const fps = seconds > 0 ? (frames / seconds).toFixed(0) : "medindo";
      const loss =
        seconds > 0 && received + lost > 0
          ? ((lost * 100) / (received + lost)).toFixed(1) + "%"
          : "medindo";
      if (frames > 0 || !this.lastVideoFrameAt)
        this.lastVideoFrameAt = Date.now();
      const stalled =
        this.running &&
        !document.hidden &&
        Date.now() - this.lastVideoFrameAt > 5000;
      this.qualityEl.textContent = `Vídeo recebido: ${fps} FPS • Perda no intervalo: ${loss} • Jitter: ${Math.round((video.jitter || 0) * 1000)} ms${stalled ? " • Sem novos quadros há mais de 5s. Verifique a conexão." : ""}`;
      this.receivedVideo = video;
    } finally {
      this.mediaSampling = false;
    }
  }
  failure(message) {
    if (this.stopped) return;
    this.status(message);
    this.loading("negotiating", message);
    if (this.loadingEl)
      this.loadingEl.querySelector("h2").textContent =
        "Não foi possível preparar a partida";
    window.toast?.error("KOF 2002", message, 10000);
    this.send("GAME_FAILED", { reason: message });
  }
  stop() {
    if (this.stopped) return;
    this.releaseAll();
    this.stopped = true;
    this.running = false;
    clearTimeout(this.offerTimer);
    clearInterval(this.loadingTimer);
    clearInterval(this.mediaTimer);
    cancelAnimationFrame(this.padTimer);
    for (const off of this.listeners || []) off();
    window.removeEventListener("message", this.messageHandler);
    this.pc?.close();
    for (const t of this.stream?.getTracks() || []) t.stop();
    try {
      this.frame?.contentWindow.arenaEmulator?.stop();
    } catch {}
    this.frame?.remove();
  }
}
window.FBNeoLoader = FBNeoLoader;
