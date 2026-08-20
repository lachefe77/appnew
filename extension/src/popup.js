import { createRequirement, renderRequirements } from "./requirements.js";
import { loadWorkspace, saveWorkspace } from "./storage.js";

const form = document.querySelector("#requirement-form");
const requirementInput = document.querySelector("#requirement");
const requirementsList = document.querySelector("#requirements");
const status = document.querySelector("#status");

let workspace;

function setStatus(message) {
  status.textContent = message;
}

async function initialize() {
  workspace = await loadWorkspace();
  renderRequirements(requirementsList, workspace.requirements);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = requirementInput.value.trim();

  if (!title) {
    setStatus("Descreva o requisito antes de salvar.");
    return;
  }

  workspace.requirements.push(createRequirement(title));
  workspace = await saveWorkspace(workspace);
  renderRequirements(requirementsList, workspace.requirements);
  requirementInput.value = "";
  setStatus("Requisito salvo apenas neste navegador.");
});

initialize().catch(() => {
  setStatus("Não foi possível carregar os requisitos locais.");
});
