/**
 * UI plano 30: lag HUD, trust, forfeit, fingerprint, push, cancel LOADING.
 */
(function () {
  function fingerprint() {
    const parts = [
      navigator.userAgent,
      navigator.language,
      screen.width + "x" + screen.height,
      Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    ];
    let h = 0;
    const s = parts.join("|");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return "fp_" + h.toString(16) + "_" + (navigator.hardwareConcurrency || 0);
  }

  window.ArenaPlano30 = {
    fingerprint,
    registerDevice() {
      const wsSend = window.wsSend;
      if (!wsSend) return;
      wsSend({ type: "REGISTER_DEVICE", fingerprint: fingerprint() });
    },
    ensureLagHud() {
      let el = document.getElementById("lagWarnHud");
      if (el) return el;
      el = document.createElement("div");
      el.id = "lagWarnHud";
      el.style.cssText =
        "display:none;position:fixed;top:70px;right:12px;z-index:11000;background:#3a1a00;border:1px solid #f5c518;color:#ffe8a0;padding:10px 12px;max-width:260px;font:700 13px Barlow Condensed,sans-serif;";
      document.body.appendChild(el);
      return el;
    },
    onLatency(cmdMs, rttMs) {
      const el = this.ensureLagHud();
      const bad = (cmdMs != null && cmdMs > 180) || (rttMs != null && rttMs > 120);
      if (!bad) {
        el.style.display = "none";
        return;
      }
      el.style.display = "block";
      el.innerHTML = `Lag alto · cmd→img ${cmdMs ?? "—"}ms · RTT ${rttMs ?? "—"}ms<br><span style="font-weight:500;color:#ccc">Considere sair da fila ou pedir ICE restart.</span>`;
    },
    showTrustBanner() {
      if (document.getElementById("trustHud")) return;
      const el = document.createElement("div");
      el.id = "trustHud";
      el.style.cssText =
        "position:fixed;left:12px;bottom:12px;z-index:9000;background:rgba(0,0,0,.7);border:1px solid #333;color:#9a958c;padding:8px 10px;max-width:280px;font:12px system-ui;";
      el.textContent =
        "Hosted: resultado pelo servidor. Isso não é anti-macro — anomalias são só sinal.";
      document.body.appendChild(el);
    },
    showForfeitHelp() {
      fetch("/api/rules/forfeit")
        .then((r) => r.json())
        .then((d) => {
          window.toast?.info(d.title, (d.rules || []).join(" · "));
        })
        .catch(() => {});
    },
    cancelLoadingMatch() {
      const mid =
        window.app?.currentMatchId || window.app?.activeMatch?.matchId;
      if (!mid) {
        window.toast?.warn("Cancelar", "Nenhuma partida em preparação.");
        return;
      }
      const ok = confirm(
        "Cancelar durante LOADING/QUEUED devolve reservas.\nApós RUNNING vira review/forfeit.\n\nConfirmar saída?",
      );
      if (ok) window.wsSend?.({ type: "CANCEL_MATCH", matchId: mid });
    },
    async subscribePush() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
      try {
        const reg = await navigator.serviceWorker.ready;
        const { publicKey } = await fetch("/api/push/vapid").then((r) =>
          r.json(),
        );
        if (!publicKey) {
          console.info("[push] VAPID_PUBLIC_KEY não configurada");
          return;
        }
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        const token = localStorage.getItem("arenaToken");
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ subscription: sub.toJSON() }),
        });
      } catch (e) {
        console.warn("[push]", e.message);
      }
    },
  };

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  document.addEventListener("DOMContentLoaded", () => {
    window.ArenaPlano30.showTrustBanner();
    setTimeout(() => window.ArenaPlano30.registerDevice(), 1500);
  });
})();
