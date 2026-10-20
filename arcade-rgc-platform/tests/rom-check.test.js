import test from "node:test";
import assert from "node:assert/strict";
import {
  installNeoGeoBios,
  verifyCoreStarted,
} from "../public/emulator-runtime.js";
import {
  inspectZip,
  validateBios,
  validateRom,
  biosFiles,
} from "../public/rom-check.js";

test("BIOS chega íntegra ao filesystem como Uint8Array, nunca ArrayBuffer", () => {
  const expected = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2]);
  let stored;
  const fs = {
    writeFile(path, bytes) {
      assert.equal(path, "/neogeo.zip");
      // Reproduce Emscripten's empty-file behavior for a raw ArrayBuffer.
      stored = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array();
    },
    readFile() {
      return stored;
    },
  };
  installNeoGeoBios(fs, expected);
  assert.deepEqual(stored, expected);
  assert.throws(() => installNeoGeoBios(fs, expected.buffer), /bytes/);
  assert.throws(() => installNeoGeoBios(fs, new Uint8Array()), /bytes/);
  assert.throws(
    () =>
      installNeoGeoBios({ ...fs, readFile: () => new Uint8Array() }, expected),
    /não corresponde/,
  );
});

test("tela de erro do FBNeo não libera GAME_READY", () => {
  assert.throws(
    () =>
      verifyCoreStarted({
        getState() {
          throw Error("Size is zero");
        },
      }),
    /não iniciou/,
  );
  assert.throws(
    () => verifyCoreStarted({ getState: () => new Uint8Array() }),
    /não iniciou/,
  );
  assert.doesNotThrow(() =>
    verifyCoreStarted({ getState: () => new Uint8Array(1024) }),
  );
});

test("ZIP inválido, vazio ou truncado não inicia emulador", () => {
  for (const size of [0, 4, 21, 100])
    assert.throws(() => inspectZip(new ArrayBuffer(size)), /ZIP/);
});
test("BIOS incompleta informa nomes e CRCs necessários", () => {
  assert.throws(
    () =>
      validateBios([{ name: "aes-bios.bin", size: 131072, crc: "9036d879" }]),
    /sm1.sm1.*94416d67.*sfix.sfix.*c2ea0cfd.*000-lo.lo.*5a86cff2/,
  );
});
test("nome correto com conteúdo de outra versão não é aceito", () => {
  assert.throws(
    () =>
      validateBios([
        { name: "sm1.sm1", size: 131072, crc: "97cf998b" },
        { name: "sfix.sfix", size: 131072, crc: "354029fc" },
        { name: "000-lo.lo", size: 65536, crc: "e09e253c" },
      ]),
    /BIOS incompatível/,
  );
});
test("BIOS exige componentes compartilhados e BIOS de sistema reconhecida", () => {
  const shared = biosFiles.map(([name, crc, size]) => ({ name, crc, size }));
  assert.throws(() => validateBios(shared), /sistema/);
  assert.equal(
    validateBios([
      ...shared,
      { name: "sp-s2.sp1", crc: "9036d879", size: 131072 },
    ]),
    true,
  );
});
test("Magic Plus ou ZIP vazio não passa como KOF 2002 original", () => {
  assert.throws(() => validateRom([]), /ROM incompatível/);
  assert.throws(
    () => validateRom([{ name: "kof2002.zip", crc: "00000000" }]),
    /Magic Plus/,
  );
});
