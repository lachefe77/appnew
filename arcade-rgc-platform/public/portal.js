import { openControls } from "./controller-settings.js";
window.ArenaControls = { open: openControls };
let updating = false;
async function refresh() {
  if (updating || document.hidden) return;
  updating = true;
  try {
    const res = await fetch("/health", {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw Error("health");
    const health = await res.json();
    if (health.status !== "ok") throw Error("health");
    document.getElementById("vtOnline").textContent = String(
      health.onlineUsers ?? "—",
    );
    document.getElementById("vtMatchesLive").textContent = String(
      health.activeMatches ?? "—",
    );
    document.querySelectorAll("[data-service-status]").forEach((e) => {
      e.textContent = "Servidor disponível";
      e.dataset.state = "online";
    });
  } catch {
    for (const id of ["vtOnline", "vtMatchesLive"])
      document.getElementById(id).textContent = "—";
    document.querySelectorAll("[data-service-status]").forEach((e) => {
      e.textContent = "Conexão indisponível";
      e.dataset.state = "offline";
    });
  } finally {
    updating = false;
  }
}
refresh();
setInterval(refresh, 15000);
document.addEventListener("visibilitychange", refresh);
// Receipts are displayed from the authenticated server event, never from a client verdict.
window.showMatchReceipt = (message) => {
  const dialog = document.createElement("dialog");
  dialog.className = "controls-dialog";
  const title = document.createElement("h2");
  title.textContent = "Confronto concluído";
  const note = document.createElement("p");
  note.className = "controls-intro";
  note.textContent =
    "Resultado recebido do servidor. Valores em créditos fictícios nesta versão.";
  const list = document.createElement("dl");
  list.className = "receipt-details";
  for (const [label, value] of [
    ["Partida", message.matchId],
    ["Vencedor", message.winnerUsername],
    ["Crédito ao vencedor", message.prizeReais],
    ["Taxa da plataforma", message.rakeReais],
  ]) {
    const row = document.createElement("div"),
      term = document.createElement("dt"),
      detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = String(value ?? "—");
    row.append(term, detail);
    list.append(row);
  }
  const close = document.createElement("button");
  close.textContent = "Concluir";
  close.onclick = () => dialog.close();
  dialog.append(title, note, list, close);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
};
