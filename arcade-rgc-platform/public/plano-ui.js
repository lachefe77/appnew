/**
 * UI do plano fliperama (itens 1–29): ping RTT, tutorial, espectador, cupom, PWA SW.
 */
(function () {
  const app = () => window.app || {};

  async function measureRtt() {
    const start = performance.now();
    try {
      await fetch("/health", { cache: "no-store" });
    } catch {
      try {
        await fetch("/api/theme", { cache: "no-store" });
      } catch {
        return 9999;
      }
    }
    return Math.round(performance.now() - start);
  }

  window.ArenaPlano = {
    async findMatchPayload(base) {
      const rttMs = await measureRtt();
      const region =
        localStorage.getItem("arenaRegion") ||
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        "BR";
      return { ...base, rttMs, region };
    },
    async spectate(matchId) {
      const wsSend = window.wsSend;
      if (!wsSend) return;
      wsSend({ type: "SPECTATE_JOIN", matchId });
    },
    leaveSpectate(matchId) {
      window.wsSend?.({ type: "SPECTATE_LEAVE", matchId });
    },
    async startTutorialIfNeeded() {
      const token =
        localStorage.getItem("arenaToken") || app().sessionToken;
      if (!token) return;
      try {
        const r = await fetch("/api/me/tutorial", {
          headers: { Authorization: "Bearer " + token },
        });
        if (!r.ok) return;
        const { prefs } = await r.json();
        if (prefs?.tutorial_done) return;
        this.showTutorial(prefs?.tutorial_step || 0);
      } catch {}
    },
    showTutorial(step = 0) {
      const steps = [
        {
          t: "Bem-vindo à Arena",
          d: "Entre numa sala KOF 2002 para desafiar ou achar partida.",
        },
        {
          t: "Modos",
          d: "Amistoso treina sem stake. Apostado reserva créditos fictícios no servidor.",
        },
        {
          t: "Série Bo3/Bo5",
          d: "Melhor de 3 ou 5: quem vencer a maioria dos jogos leva a série.",
        },
        {
          t: "Ready-check",
          d: "Quando a partida achar oponente, confirme Ready antes do countdown.",
        },
        {
          t: "Revanche e espectador",
          d: "Após o duelo, peça revanche. Partidas ao vivo podem ser assistidas em modo leitura.",
        },
      ];
      const s = steps[Math.min(step, steps.length - 1)];
      let el = document.getElementById("tutorialWizard");
      if (!el) {
        el = document.createElement("div");
        el.id = "tutorialWizard";
        el.style.cssText =
          "position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:12000;display:flex;align-items:center;justify-content:center;padding:16px;";
        document.body.appendChild(el);
      }
      el.innerHTML = `<div style="max-width:420px;background:#121214;border:1px solid #2a2a2e;padding:22px;font-family:Barlow Condensed,sans-serif;">
        <div style="font:800 1.4rem Oswald,sans-serif;margin-bottom:8px;">${s.t}</div>
        <p style="color:#9a958c;margin:0 0 16px;line-height:1.4;">${s.d}</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="tutSkip" style="background:transparent;border:1px solid #444;color:#aaa;padding:8px 12px;cursor:pointer;">Pular</button>
          <button id="tutNext" style="background:#e10600;border:0;color:#fff;padding:8px 16px;cursor:pointer;font-weight:800;">${step >= steps.length - 1 ? "Concluir" : "Próximo"}</button>
        </div>
        <div style="margin-top:10px;font-size:.75rem;color:#666;">Passo ${step + 1}/${steps.length}</div>
      </div>`;
      const save = async (done, nextStep) => {
        const token =
          localStorage.getItem("arenaToken") || app().sessionToken;
        if (!token) return;
        await fetch("/api/me/tutorial", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ done, step: nextStep }),
        }).catch(() => {});
      };
      el.querySelector("#tutSkip").onclick = async () => {
        await save(true, steps.length);
        el.remove();
      };
      el.querySelector("#tutNext").onclick = async () => {
        if (step >= steps.length - 1) {
          await save(true, steps.length);
          el.remove();
        } else {
          await save(false, step + 1);
          this.showTutorial(step + 1);
        }
      };
    },
    async redeemCoupon() {
      const code = prompt("Código do cupom:");
      if (!code) return;
      const token =
        localStorage.getItem("arenaToken") || app().sessionToken;
      const r = await fetch("/api/coupon/redeem", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) window.toast?.error("Cupom", body.error || "Falha");
      else
        window.toast?.success(
          "Cupom",
          body.message || "Aplicado. Saldo: R$ " + body.newBalanceReais,
        );
    },
    registerServiceWorker() {
      if (!("serviceWorker" in navigator)) return;
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    },
    showFinanceHonesty() {
      fetch("/api/finance/mode")
        .then((r) => r.json())
        .then((m) => {
          const el = document.getElementById("financeModeBadge");
          if (el) el.textContent = m.label || "";
        })
        .catch(() => {});
    },
  };

  document.addEventListener("DOMContentLoaded", () => {
    window.ArenaPlano.registerServiceWorker();
    window.ArenaPlano.showFinanceHonesty();
  });
})();
