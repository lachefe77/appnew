export function createRequirement(title) {
  return {
    id: crypto.randomUUID(),
    title,
    createdAt: new Date().toISOString(),
    status: "planned",
  };
}

export function renderRequirements(container, requirements) {
  container.replaceChildren();

  if (requirements.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "Nenhum requisito registrado.";
    container.append(empty);
    return;
  }

  for (const requirement of requirements) {
    const item = document.createElement("li");
    item.textContent = requirement.title;
    container.append(item);
  }
}
