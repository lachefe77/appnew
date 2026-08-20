const note = document.querySelector("#note");
const status = document.querySelector("#status");
const save = document.querySelector("#save");

async function restoreNote() {
  const { requirementNote = "" } = await chrome.storage.local.get("requirementNote");
  note.value = requirementNote;
}

save.addEventListener("click", async () => {
  await chrome.storage.local.set({ requirementNote: note.value.trim() });
  status.textContent = "Nota salva apenas neste navegador.";
});

restoreNote().catch(() => {
  status.textContent = "Não foi possível carregar a nota local.";
});
