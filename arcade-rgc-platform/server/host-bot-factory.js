/**
 * Seleciona o motor hosted: chrome (legado Playwright) ou native (Host Bot).
 */
import { HostedSession } from "./hosted-session.js";
import { NativeHostSession } from "./native-host-session.js";

export function resolveHostedEngine(
  raw = process.env.HOSTED_ENGINE || "chrome",
) {
  const v = String(raw || "chrome").toLowerCase().trim();
  if (v === "native" || v === "hostbot" || v === "bot") return "native";
  return "chrome";
}

export function createHostedFactory(engine = resolveHostedEngine()) {
  if (engine === "native") {
    return (options) => new NativeHostSession(options);
  }
  return (options) => new HostedSession(options);
}

export const defaultHostedFactory = createHostedFactory();
