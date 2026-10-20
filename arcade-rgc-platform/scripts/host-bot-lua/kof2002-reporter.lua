-- KOF 2002 sample reporter for FBNeo (Host Bot Fase 1).
-- Emite uma linha JSON por frame no stdout do core (quando suportado)
-- ou via print() — o worker Node captura e encaminha como event:"sample".
--
-- Endereços: peon2/fbneo-training-mode + fightcade detectors (68K RAM).
-- Base Neo Geo 68K RAM = 0x100000. Offsets do observer EJS são relativos;
-- aqui usamos endereços CPU absolutos (sem byte-swap de RASTATE).

local ADDR = {
  health = { 0x108239, 0x108439 },
  timer = 0x10A7D3,
  wins = { 0x10DAB6, 0x10DAB8 },
}

local function rb(addr)
  -- FBNeo training-mode / Fightcade Lua
  if memory and memory.readbyte then
    return memory.readbyte(addr)
  end
  -- libretro FBNeo (algumas builds)
  if mainmemory and mainmemory.read_u8 then
    return mainmemory.read_u8(addr - 0x100000)
  end
  return 0
end

local frame = 0

local function emit_sample()
  frame = frame + 1
  local sample = string.format(
    '{"frame":%d,"health":[%d,%d],"timer":%d,"wins":[%d,%d]}',
    frame,
    rb(ADDR.health[1]),
    rb(ADDR.health[2]),
    rb(ADDR.timer),
    rb(ADDR.wins[1]),
    rb(ADDR.wins[2])
  )
  -- Prefixo fixo para o worker filtrar linhas do core
  print("ARENA_SAMPLE " .. sample)
end

-- Hooks comuns (FBNeo vs BizHawk-style)
if emu and emu.registerafter then
  emu.registerafter(emit_sample)
elseif emu and emu.frameadvance then
  while true do
    emit_sample()
    emu.frameadvance()
  end
else
  -- Fallback: registra callback genérico se disponível
  if gui and gui.register then
    gui.register(emit_sample)
  end
end
