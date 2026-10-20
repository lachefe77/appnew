const token =
  localStorage.getItem("arenaToken") ||
  sessionStorage.getItem("arenaAdminToken");
const status = document.querySelector("#status"),
  list = document.querySelector("#list");
async function api(path, data) {
  const response = await fetch(path, {
    method: data ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const body = await response.json();
  if (!response.ok)
    throw Object.assign(
      Error(body.error || body.message || "Falha na requisição."),
      { status: response.status },
    );
  return body;
}
function element(tag, text, parent) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
  return node;
}
async function load() {
  list.replaceChildren();
  status.textContent = "Consultando revisões…";
  try {
    if (!token)
      throw Error("Entre na plataforma para consultar suas revisões.");
    let data,
      admin = false;
    try {
      data = await api("/api/admin/match-reviews");
      admin = true;
    } catch (error) {
      if (error.status !== 403) throw error;
      data = await api("/api/my-reviews");
    }
    status.textContent = `${admin ? "Administração" : "Suas partidas"}: ${data.reviews.length} revisões recentes.`;
    for (const review of data.reviews) {
      const card = element("article", "", list);
      element("h2", review.match_id, card);
      element(
        "p",
        `Estado: ${review.status === "OPEN" ? "Em análise" : "Encerrada"} • Reserva por jogador: R$ ${(review.stake_cents / 100).toFixed(2)}`,
        card,
      );
      element("p", review.reason, card);
      element(
        "p",
        "Prazo: " + new Date(review.deadline_at).toLocaleString("pt-BR"),
        card,
      );
      if (review.decision)
        element(
          "p",
          `Decisão: ${review.decision} • ${review.decision_reason}`,
          card,
        );
      const eventsButton = element(
        "button",
        "Consultar registro e regras",
        card,
      );
      const events = element("pre", "", card);
      eventsButton.onclick = async () => {
        eventsButton.disabled = true;
        try {
          const data = await api(
            `/api/matches/${encodeURIComponent(review.match_id)}/integrity`,
          );
          events.textContent = JSON.stringify(data, null, 2);
        } catch (error) {
          events.textContent = error.message;
        } finally {
          eventsButton.disabled = false;
        }
      };
      if (admin && review.status === "OPEN") {
        const label = element("label", "Decisão administrativa: ", card),
          select = element("select", "", label);
        for (const [value, title] of [
          ["REFUND", "Estornar ambos"],
          ["PLAYER_A", `Vitória P1 — ${review.player_a}`],
          ["PLAYER_B", `Vitória P2 — ${review.player_b}`],
        ]) {
          const option = element("option", title, select);
          option.value = value;
        }
        const reasonLabel = element(
          "label",
          "Justificativa e referência às evidências",
          card,
        );
        const reason = element("textarea", "", reasonLabel);
        reason.minLength = 20;
        reason.maxLength = 1000;
        const submit = element("button", "Registrar decisão", card);
        submit.onclick = async () => {
          if (reason.value.trim().length < 20) {
            status.textContent =
              "Descreva as evidências e a justificativa em pelo menos 20 caracteres.";
            return;
          }
          if (
            !confirm(
              "Confirmar a decisão? Ela movimentará os créditos reservados e ficará registrada.",
            )
          )
            return;
          submit.disabled = true;
          try {
            await api(
              `/api/admin/match-reviews/${encodeURIComponent(review.match_id)}`,
              { decision: select.value, reason: reason.value },
            );
            await load();
          } catch (error) {
            status.textContent = error.message;
            submit.disabled = false;
          }
        };
      }
    }
  } catch (error) {
    status.textContent = error.message;
  }
}
document.querySelector("#refresh").onclick = load;
load();
