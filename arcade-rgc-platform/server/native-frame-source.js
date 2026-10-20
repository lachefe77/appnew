/**
 * Fonte de frames 320×240 I420 @ 30fps para Host Bot.
 * - synthetic: barras (lab)
 * - external: framebuffer FBNeo/ffmpeg / injectFrame (prioridade se fresco)
 */
import fs from "node:fs";
import path from "node:path";

export const NATIVE_FRAME = Object.freeze({
  width: 320,
  height: 240,
  fps: 30,
});

/** I420 size = Y + U/4 + V/4 */
export function i420ByteLength(
  width = NATIVE_FRAME.width,
  height = NATIVE_FRAME.height,
) {
  return (width * height * 3) / 2;
}

/**
 * Preenche buffer I420 com barras + “tick” de frame (lab visual).
 */
export function paintSyntheticI420(data, frame, opts = {}) {
  const width = opts.width || NATIVE_FRAME.width;
  const height = opts.height || NATIVE_FRAME.height;
  const ySize = width * height;
  const paused = !!opts.paused;
  const bar = ((frame / 2) | 0) % width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = paused ? 40 : 60 + ((x + y + frame) & 63);
      if (x === bar) v = 220;
      if (x < 8 && y < 8) v = (frame * 17) & 255;
      data[y * width + x] = v;
    }
  }
  data.fill(128, ySize, ySize + ySize / 2);
  return { width, height, data };
}

/** RGB24 → I420 (BT.601 aproximado), escala nearest para target WxH. */
export function rgb24ToI420(
  rgb,
  srcW,
  srcH,
  destW = NATIVE_FRAME.width,
  destH = NATIVE_FRAME.height,
) {
  const out = Buffer.alloc(i420ByteLength(destW, destH));
  const yPlane = destW * destH;
  for (let dy = 0; dy < destH; dy++) {
    const sy = Math.min(srcH - 1, ((dy * srcH) / destH) | 0);
    for (let dx = 0; dx < destW; dx++) {
      const sx = Math.min(srcW - 1, ((dx * srcW) / destW) | 0);
      const i = (sy * srcW + sx) * 3;
      const r = rgb[i];
      const g = rgb[i + 1];
      const b = rgb[i + 2];
      out[dy * destW + dx] = Math.min(
        255,
        Math.max(0, ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16),
      );
    }
  }
  for (let dy = 0; dy < destH; dy += 2) {
    const sy = Math.min(srcH - 1, ((dy * srcH) / destH) | 0);
    for (let dx = 0; dx < destW; dx += 2) {
      const sx = Math.min(srcW - 1, ((dx * srcW) / destW) | 0);
      const i = (sy * srcW + sx) * 3;
      const r = rgb[i];
      const g = rgb[i + 1];
      const b = rgb[i + 2];
      const u = Math.min(
        255,
        Math.max(0, ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128),
      );
      const v = Math.min(
        255,
        Math.max(0, ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128),
      );
      const uvIndex = (dy >> 1) * (destW >> 1) + (dx >> 1);
      out[yPlane + uvIndex] = u;
      out[yPlane + (destW * destH) / 4 + uvIndex] = v;
    }
  }
  return out;
}

/**
 * Normaliza payload externo para I420 320×240.
 * @param {{ width?: number, height?: number, format?: string, data: Buffer|Uint8Array|string }} raw
 */
export function normalizeExternalFrame(raw, destW = NATIVE_FRAME.width, destH = NATIVE_FRAME.height) {
  if (!raw?.data) throw Error("Frame externo sem data.");
  let buf =
    typeof raw.data === "string"
      ? Buffer.from(raw.data, "base64")
      : Buffer.from(raw.data);
  const format = String(raw.format || "i420").toLowerCase();
  const srcW = Number(raw.width) || destW;
  const srcH = Number(raw.height) || destH;
  if (format === "rgb24" || format === "rgb") {
    const need = srcW * srcH * 3;
    if (buf.length < need) throw Error("RGB24 truncado.");
    buf = rgb24ToI420(buf.subarray(0, need), srcW, srcH, destW, destH);
  } else if (format === "i420" || format === "yuv420p") {
    const need = i420ByteLength(srcW, srcH);
    if (buf.length < need) throw Error("I420 truncado.");
    if (srcW !== destW || srcH !== destH) {
      // Sem scaler I420 completo no lab: exige 320×240 ou RGB24.
      throw Error(
        `I420 deve ser ${destW}x${destH} (recebido ${srcW}x${srcH}); use format rgb24 para escalar.`,
      );
    }
    buf = Buffer.from(buf.subarray(0, need));
  } else {
    throw Error("Formato de frame não suportado: " + format);
  }
  return { width: destW, height: destH, data: buf, format: "i420" };
}

export function createFrameSource({
  width = NATIVE_FRAME.width,
  height = NATIVE_FRAME.height,
  fps = NATIVE_FRAME.fps,
  onFrame,
  /** ms: se external mais fresco que isto, não pinta synthetic */
  externalTtlMs = 400,
  mode = "auto", // auto | synthetic | external
} = {}) {
  const data = Buffer.alloc(i420ByteLength(width, height));
  let frame = 0;
  let paused = true;
  let timer = null;
  let closed = false;
  let externalCount = 0;
  let lastExternal = null; // { at, width, height, data, frame }

  function push() {
    if (closed || !onFrame) return;
    const now = Date.now();
    const useExternal =
      mode !== "synthetic" &&
      lastExternal &&
      (mode === "external" || now - lastExternal.at <= externalTtlMs);

    if (useExternal) {
      onFrame({
        width: lastExternal.width,
        height: lastExternal.height,
        data: lastExternal.data,
        frame: lastExternal.frame,
        paused,
        source: "external",
      });
      if (!paused) frame++;
      return;
    }

    if (mode === "external") {
      // Sem frame fresco: reenvia último ou preto
      if (lastExternal) {
        onFrame({
          width: lastExternal.width,
          height: lastExternal.height,
          data: lastExternal.data,
          frame: lastExternal.frame,
          paused,
          source: "external-stale",
        });
      }
      return;
    }

    const sample = paintSyntheticI420(data, frame, { width, height, paused });
    onFrame({
      width,
      height,
      data: sample.data,
      frame,
      paused,
      source: "synthetic",
    });
    if (!paused) frame++;
  }

  function start() {
    if (closed || timer) return;
    const ms = Math.max(8, Math.round(1000 / fps));
    timer = setInterval(push, ms);
    if (typeof timer.unref === "function") timer.unref();
    push();
  }

  return {
    width,
    height,
    fps,
    get frame() {
      return frame;
    },
    get paused() {
      return paused;
    },
    get externalCount() {
      return externalCount;
    },
    get lastExternalAt() {
      return lastExternal?.at || null;
    },
    get sourceMode() {
      return mode;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    start,
    /**
     * Injeta framebuffer externo (FBNeo/ffmpeg/lab).
     * @param {{ width?: number, height?: number, format?: string, data: Buffer|string }} raw
     */
    pushExternal(raw) {
      const norm = normalizeExternalFrame(raw, width, height);
      externalCount++;
      const n = frame;
      if (!paused) frame++;
      lastExternal = {
        at: Date.now(),
        width: norm.width,
        height: norm.height,
        data: norm.data,
        frame: n,
      };
      if (onFrame && !closed) {
        onFrame({
          width: norm.width,
          height: norm.height,
          data: norm.data,
          frame: n,
          paused,
          source: "external",
        });
      }
      return lastExternal;
    },
    writePpmEvidence(filePath, labelFrame = frame) {
      const src =
        lastExternal?.data && Date.now() - lastExternal.at < 2000
          ? lastExternal.data
          : paintSyntheticI420(data, labelFrame, { width, height, paused }).data;
      const rgba = Buffer.alloc(width * height * 3);
      for (let i = 0; i < width * height; i++) {
        const y = src[i];
        rgba[i * 3] = y;
        rgba[i * 3 + 1] = y;
        rgba[i * 3 + 2] = y;
      }
      const header = Buffer.from(`P6\n${width} ${height}\n255\n`);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, Buffer.concat([header, rgba]));
      return filePath;
    },
    stop() {
      closed = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
