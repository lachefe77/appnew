// EmulatorJS 4.2.3 needs a typed array when writing to its Emscripten filesystem.
export function installNeoGeoBios(fs, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0)
    throw Error("A BIOS precisa conter os bytes do ZIP selecionado.");
  fs.writeFile("/neogeo.zip", bytes);
  const installed = fs.readFile("/neogeo.zip");
  if (
    installed.length !== bytes.length ||
    !installed.every((byte, i) => byte === bytes[i])
  )
    throw Error(
      "A BIOS gravada no emulador não corresponde ao ZIP selecionado.",
    );
}

export function verifyCoreStarted(manager) {
  // FBNeo's error screen also emits EmulatorJS's start event. Unlike a loaded
  // game, that screen has no serializable machine state ("Size is zero").
  try {
    const state = manager.getState();
    if (!(state instanceof Uint8Array) || state.length < 16) throw Error();
  } catch {
    throw Error(
      "O FBNeo não iniciou o jogo. Confira ROM e BIOS; cancele a partida e carregue novamente.",
    );
  }
}
