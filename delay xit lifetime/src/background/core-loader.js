const HOUSE_HOST_RE =
  /estrelabet|pagol\.bet|vupi\.bet|br4\.bet|esportiva\.bet|biahosted/i;
const LOCAL_HOOK = "js-clean/page-hook.js";
const LOCAL_COLLECTOR = "js-clean/collector.js";

const SESSION_KEY = "et_core_session";

function localSession() {
  return {
    authorized: true,
    ready: true,
    ok: true,
    token: "local",
    grant: "local",
    version: chrome.runtime.getManifest().version,
    house: "*",
    config: {},
    exp: Date.now() + 31536000000,
  };
}

let session = localSession();
let watching = false;

export function isCoreReady() {
  return true;
}

export function getCoreSession() {
  return session;
}

export async function applyCoreSession(next) {
  session = { ...localSession(), ...(next || {}) };
  try {
    await chrome.storage.local.set({ [SESSION_KEY]: session });
  } catch {}
  return session;
}

export async function restoreCoreSession() {
  try {
    const bag = await chrome.storage.local.get(SESSION_KEY);
    if (bag && bag[SESSION_KEY]) session = { ...localSession(), ...bag[SESSION_KEY] };
  } catch {}
  session = { ...localSession(), ...session, authorized: true, ready: true };
  return session;
}

export async function wipeCoreSession() {
  session = localSession();
  try {
    await chrome.storage.local.remove(SESSION_KEY);
  } catch {}
}

async function wipeRemoteCore() {}

function houseFromUrl(url) {
  const u = String(url || "");
  if (/estrelabet/i.test(u)) return "estrelabet";
  if (/pagol/i.test(u)) return "pagol";
  if (/vupi/i.test(u)) return "vupi";
  if (/br4/i.test(u)) return "br4bet";
  if (/esportiva/i.test(u)) return "esportiva";
  return null;
}

async function injectIntoTab(tabId) {
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [LOCAL_HOOK],
      world: "MAIN",
      injectImmediately: true,
    });
  } catch {}
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [LOCAL_COLLECTOR],
      world: "ISOLATED",
    });
  } catch {}
}

export async function injectAllHouseTabs() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  for (const tab of tabs) {
    if (tab.id && HOUSE_HOST_RE.test(String(tab.url || ""))) await injectIntoTab(tab.id);
  }
}

export async function detectOpenHouse() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tabs && tabs[0] && tabs[0].url;
    return houseFromUrl(url);
  } catch {
    return null;
  }
}

export function watchTabsForCore() {
  if (watching) return;
  watching = true;
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status === "complete" && HOUSE_HOST_RE.test(String(tab && tab.url))) {
      injectIntoTab(tabId);
    }
  });
}

export async function authorizeFromServer(_opts) {
  await applyCoreSession(localSession());
  watchTabsForCore();
  await injectAllHouseTabs();
  try {
    const bag = await chrome.storage.local.get("settings");
    const settings = Object.assign({}, bag.settings || {}, {
      license_key: "local",
      license_valid: true,
      license_end: Date.now() + 31536000000,
      license_id: "local",
      license_error: null,
      license_houses: ["*"],
      core_ready: true,
      core_authorized: true,
    });
    await chrome.storage.local.set({ settings });
  } catch {}
  return session;
}

export async function authorizeFromServerWs() {
  return authorizeFromServer();
}

export async function loadRemoteCore() {
  return { ok: true, local: true };
}

authorizeFromServer().catch(() => {});
