/**
 * Fonte de frames 320×240 I420 @ 30fps para Host Bot Fase 2.
 * Lab: padrão sintético. Depois: framebuffer FBNeo/ffmpeg → onFrame.
 */
import fs from "node:fs";
import path from "node:path";

export const NATIVE_FRAME = Object.freeze({
  width: 320,
  height: 240,
  fps: 30,
});

/** I420 size = Y + U/4 + V/4 */
export function i420ByteLength(width = NATIVE_FRAME.width, height = NATIVE_FRAME.height) {
  return width * height + (width * height) / 2;
}

/**
 * Preenche buffer I420 com barras + “tick” de frame (lab visual).
 * @param {Buffer|Uint8Array} data
 * @param {number} frame
 * @param {{ width?: number, height?: number, paused?: boolean }} [opts]
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
      // canto: marca de frame (bloco claro)
      if (x < 8 && y < 8) v = (frame * 17) & 255;
      data[y * width + x] = v;
    }
  }
  // chroma neutro
  data.fill(128, ySize, ySize + ySize / 2);
  return { width, height, data };
}

export function createFrameSource({
  width = NATIVE_FRAME.width,
  height = NATIVE_FRAME.height,
  fps = NATIVE_FRAME.fps,
  onFrame,
} = {}) {
  const data = Buffer.alloc(i420ByteLength(width, height));
  let frame = 0;
  let paused = true;
  let timer = null;
  let closed = false;

  function push() {
    if (closed || !onFrame) return;
    const sample = paintSyntheticI420(data, frame, { width, height, paused });
    onFrame({ width, height, data: sample.data, frame, paused });
    if (!paused) frame++;
  }

  function start() {
    if (closed || timer) return;
    const ms = Math.max(8, Math.round(1000 / fps));
    timer = setInterval(push, ms);
    timer.unref?.();
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
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    start,
    /** Dump PPM (P6) para evidência lab — sem ffmpeg. */
    writePpmEvidence(filePath, labelFrame = frame) {
      const rgba = Buffer.alloc(width * height * 3);
      paintSyntheticI420(data, labelFrame, { width, height, paused });
      for (let i = 0; i < width * height; i++) {
        const y = data[i];
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
