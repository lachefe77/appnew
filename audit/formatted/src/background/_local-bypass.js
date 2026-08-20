if (!globalThis.__et_local_bypass) {
  globalThis.__et_local_bypass = true;

  // Local: licença válida, sem servidor deles, tempo na notificação de aposta.
  const REMOTE =
    /179\.197\.231\.55|profit-boost-api|ringed-authorization|workers\.dev/i;

  function jsonResponse(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function stubForUrl(url) {
    const u = String(url || "").toLowerCase();
    if (/verify|fire_auth|license|auth|authorize|session|grant|core/.test(u)) {
      return jsonResponse({
        ok: true,
        success: true,
        authorized: true,
        grant: "local",
        token: "local",
        exp: Date.now() + 31536000000,
        ttl_ms: 31536000000,
        license_end: Date.now() + 31536000000,
        license_id: "local",
        houses: ["*"],
      });
    }
    if (/window/.test(u)) return jsonResponse({ ok: false });
    if (/telemetry|crypto|order/.test(u))
      return jsonResponse({ ok: false, error: "local" });
    return jsonResponse({ ok: true, success: true, grant: "local" });
  }

  const LICENSE = {
    license_key: "local",
    license_valid: true,
    license_end: Date.now() + 31536000000,
    license_id: "local",
    license_error: null,
    license_houses: ["*"],
    license_house_ends: {},
    license_houses_enabled: null,
    license_houses_hidden: null,
    core_ready: true,
    core_authorized: true,
  };

  function overlaySettings(obj) {
    if (!obj || typeof obj !== "object") return obj;
    if (!obj.settings || typeof obj.settings !== "object") {
      if (!("settings" in obj)) return obj;
      obj.settings = {};
    }
    Object.assign(obj.settings, LICENSE);
    return obj;
  }

  try {
    const origFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = function (input, init) {
      const url = String(input && input.url ? input.url : input);
      if (REMOTE.test(url)) return Promise.resolve(stubForUrl(url));
      return origFetch(input, init);
    };
  } catch {}

  try {
    if (globalThis.chrome?.storage?.local?.get) {
      const origGet = chrome.storage.local.get.bind(chrome.storage.local);
      chrome.storage.local.get = function (keys, cb) {
        if (typeof keys === "function") {
          cb = keys;
          keys = null;
        }
        if (typeof cb === "function") {
          return origGet(keys, (result) => cb(overlaySettings(result)));
        }
        const ret = origGet(keys);
        if (ret && typeof ret.then === "function")
          return ret.then(overlaySettings);
        overlaySettings(ret);
        return ret;
      };
    }
  } catch {}

  try {
    if (globalThis.chrome?.storage?.local?.set) {
      const origSet = chrome.storage.local.set.bind(chrome.storage.local);
      chrome.storage.local.set = function (items, cb) {
        try {
          const s = items && items.settings;
          if (s && s.last_try_at)
            globalThis.__et_last_try_at = Number(s.last_try_at) || Date.now();
          else if (items && items.last_try_at)
            globalThis.__et_last_try_at =
              Number(items.last_try_at) || Date.now();
        } catch {}
        return origSet(items, cb);
      };
    }
  } catch {}

  try {
    if (globalThis.chrome?.notifications?.create) {
      const origCreate = chrome.notifications.create.bind(chrome.notifications);
      chrome.notifications.create = function (id, options, cb) {
        let opts = options;
        let nid = id;
        if (typeof id === "object") {
          opts = id;
          nid = "";
          cb = options;
        }
        if (opts && typeof opts === "object") {
          const title = String(opts.title || "");
          const last = Number(globalThis.__et_last_try_at) || 0;
          if (
            last > 0 &&
            /aposta feita|aposta recusada/i.test(
              title + " " + (opts.message || ""),
            )
          ) {
            const sec = ((Date.now() - last) / 1000).toFixed(2);
            const suffix = /aposta feita/i.test(
              title + " " + (opts.message || ""),
            )
              ? " · feita em " + sec + "s"
              : " · em " + sec + "s";
            opts = { ...opts, message: (opts.message || "") + suffix };
          }
        }
        if (typeof id === "object") return origCreate(opts, cb);
        return origCreate(nid, opts, cb);
      };
    }
  } catch {}
}
