const STORAGE_KEY = "rebuildWorkspace";

export const defaultWorkspace = {
  requirements: [],
  updatedAt: null,
};

export async function loadWorkspace() {
  const { [STORAGE_KEY]: workspace } = await chrome.storage.local.get(STORAGE_KEY);
  return {
    ...defaultWorkspace,
    ...workspace,
    requirements: Array.isArray(workspace?.requirements) ? workspace.requirements : [],
  };
}

export async function saveWorkspace(workspace) {
  const nextWorkspace = {
    ...defaultWorkspace,
    ...workspace,
    updatedAt: new Date().toISOString(),
  };

  await chrome.storage.local.set({ [STORAGE_KEY]: nextWorkspace });
  return nextWorkspace;
}
