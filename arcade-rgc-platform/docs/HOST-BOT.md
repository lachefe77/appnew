# Host Bot nativo — plano de execução (sem Chrome)

## Objetivo de negócio

- **Agora (VPS teste):** Windows, **4 GB RAM**, **2 vCPU**, 40 GB disco.  
  Meta de engenharia: **projetar para 20 X1**; meta medida nesta máquina: começar em **5–8**, subir com prova de carga.
- **Produção próxima:** Windows ~**10 GB RAM (10240 MB)**, **~5 vCPU**.  
  Meta: **20 X1** confortáveis com margem.
- **Invariantes:** autoridade no servidor (anti-injeção), sem PIX real, sem Bomberman, tema/layout congelado.

## Por que não Chrome

Cada X1 no modelo atual abre Edge/Chromium + WASM + encode. Isso é certo contra cheat de memória e errado para densidade. O Host Bot troca o **motor**, não o **modelo de confiança**.

## Analogia RGC / bot de host

Como o bot de host do RGC (Warcraft/Dota 1): um processo leve por sala/partida hospeda o jogo, aplica regras e entrega o resultado. No Arena:

- 1 **Host Bot** por X1 (2 jogadores)
- Bot roda o core **fora do browser**
- Jogadores só recebem mídia + enviam input autorizado
- Observer / settle continuam no servidor Node

## Arquitetura alvo

```
[Cliente P1] ──WS/WebRTC──┐
                           ├──► platform.js ──► HostBotFactory
[Cliente P2] ──WS/WebRTC──┘         │
                                    ▼
                         NativeHostSession (Node)
                                    │ IPC JSONL
                                    ▼
                         host-bot process (FBNeo/libretro nativo)
                         + Lua sample bridge (Fase 1)
                         + encode leve (ffmpeg / LiveKit SFU)  ← Fase 2
```

Chrome/`HostedSession` permanece como `HOSTED_ENGINE=chrome` (lab/legado).  
Produção leve: `HOSTED_ENGINE=native`.

## Fases

| Fase | Entrega | Critério de pronto |
|---|---|---|
| **0** | Plano + factory + stub IPC + testes | `npm test` verde; engine selecionável |
| **1** | Bot Windows: spawn + input + sample de estado | 1 X1 lab sem Playwright ✅ |
| **2** | Encode leve + WebRTC para 2 peers (320p30) | 2 viewers com track sem Chrome ✅ |
| **2b** | Framebuffer FBNeo/ffmpeg → WebRTC | injectFrame + pipe ffmpeg (gdigrab/lavfi) ✅ |
| **3** | Capacidade medida na VPS 4 GB | Bench N sessões + relatório; ≥600s na VPS ✅ |
| **4** | `HOSTED_MAX_SESSIONS=6` + fila QUEUED | Smoke fila + env ✅ |
| **4b** | RetroArch/FBNeo + input + gdigrab | Spawn core + teclado Win + ffmpeg |
| **5** | VPS 10 GB / 5 vCPU (depois) | Validar ~20 X1 — **adiar** até VPS dedicado |

## Fase 1 — sample sem Chrome

| Peça | Papel |
|---|---|
| `Kof2002Observer.observeSample` | Mesma máquina de estados; **sem** RASTATE/EJS |
| `native-input-map.js` | Botão Arena → tecla / bind RetroArch |
| `native-host-launcher.js` | Cmdline stub ou RetroArch/FBNeo |
| Worker `event:"sample"` | Estado JSON (stub ou Lua) |
| `kof2002-reporter.lua` | RAM peon2/Fightcade → `ARENA_SAMPLE` |

Savestate nativo ≠ layout EmulatorJS — por isso Lua/JSON, não RASTATE.

## Fase 2 — encode 320p30 + WebRTC

| Peça | Papel |
|---|---|
| `native-frame-source.js` | I420 320×240 @ 30fps (synthetic **ou** external) |
| `native-webrtc.js` | 2× `RTCPeerConnection` via `@roamhq/wrtc` |
| Worker `cmd:"signal"` | `viewer-ready` / `offer` / `answer` / `ice` |

## Fase 2b (atual) — framebuffer → WebRTC

| Peça | Papel |
|---|---|
| `native-framebuffer.js` | ffmpeg raw I420 + parse `ARENA_FRAME` |
| `injectFrame` | Lab/testes: RGB24/I420 base64 → encode |
| `HOST_BOT_FFMPEG_*` | Captura janela RetroArch (gdigrab) ou lavfi |

Prioridade do frame source: **external fresco** (> synthetic). Sem framebuffer, continua barras.

### Protocolo JSONL

```text
→ { "cmd":"start"|"input"|"signal"|"injectFrame"|"injectSample"|"captureEvidence"|... }
→ ARENA_FRAME {"width":320,"height":240,"format":"i420","data":"<base64>"}
← { "event":"frame", "externalCount": N }
← { "event":"signal"|"peer"|"sample"|... }
```

### Teste no PC Windows (PowerShell)

Repo git = `Documents\appnew`. App = `arcade-rgc-platform` dentro dele.

```powershell
cd "C:\Users\Pc Gamer\Documents\appnew"
git pull
cd arcade-rgc-platform
npm ci
$env:HOSTED_ENGINE="native"
npm run smoke:host-bot -- 1 webrtc
npm run smoke:host-bot -- 1 framebuffer
```

Esperado framebuffer: `mode:"framebuffer"`, `externalCount:30`, `tracks:{1:true,2:true}`.

Com RetroArch + ffmpeg no PATH (vídeo da janela do core):

```powershell
# Terminal 1: abre RetroArch com KOF (FBNeo)
# Terminal 2:
$env:HOSTED_ENGINE="native"
$env:HOST_BOT_FFMPEG="ffmpeg"
$env:HOST_BOT_FFMPEG_INPUT_KIND="gdigrab"
$env:HOST_BOT_FFMPEG_INPUT="title=RetroArch"
npm run smoke:host-bot -- 1 webrtc
```

Lab sem RetroArch (ffmpeg gera testsrc):

```powershell
$env:HOST_BOT_FFMPEG_INPUT_KIND="lavfi"
$env:HOST_BOT_FFMPEG_INPUT="testsrc=size=320x240:rate=30"
npm run smoke:host-bot -- 1 webrtc
```

## Fase 3 — capacidade medida ✅

Bench 6×600s no teu PC → `HOSTED_MAX_SESSIONS=6`. Relatório em `data/capacity/latest.json`.

## Fase 4 (atual) — limite + fila

```powershell
cd "C:\Users\Pc Gamer\Documents\appnew"
git pull
cd arcade-rgc-platform
npm ci

# .env (cria se não existir):
# HOSTED_ENGINE=native
# HOSTED_MAX_SESSIONS=6

npm run check:host-bot
npm run smoke:hosted-queue
```

`smoke:hosted-queue` sobe fixture com cap=1, enfileira 2ª partida APOSTADO e promove ao cancelar a 1ª.

## Fase 4b — jogo real (RetroArch + vídeo + input)

1. Instala RetroArch + core FBNeo; `ffmpeg` no PATH.  
2. ROM/BIOS: `npm run setup:hosted -- --rom "C:\caminho\kof2002.zip" --bios "C:\caminho\neogeo.zip"`  
3. No `.env`:

```env
HOSTED_ENGINE=native
HOSTED_MAX_SESSIONS=6
HOST_BOT_BIN=C:\caminho\retroarch.exe
HOST_BOT_KIND=retroarch
HOST_BOT_WORKDIR=data/hosted/kof2002
HOST_BOT_FFMPEG=ffmpeg
HOST_BOT_FFMPEG_INPUT_KIND=gdigrab
HOST_BOT_FFMPEG_INPUT=title=RetroArch
HOST_BOT_INPUT=auto
```

4. Testa:

```powershell
npm run check:host-bot
$env:HOSTED_ENGINE="native"
# Carrega .env no start do server; smoke do worker:
npm run smoke:host-bot -- 1 webrtc
npm run test:local
```

O worker spawna o RetroArch, injeta teclas (Windows) e captura a janela via gdigrab → WebRTC.  
Sem `HOST_BOT_BIN`, continua stub (fila/WebRTC lab OK).

## Números honestos

| Máquina | Engine | Estimativa (`/api/ops/hosted-cap`) |
|---|---|---|
| 4 GB / 2 vCPU | Chrome | **1** |
| 4 GB / 2 vCPU | Native + encode leve | **~5–8** (começar medindo em 4–6) |
| 10 GB (10240 MB) / 5 vCPU | Native + encode leve | **~15–20** (meta 20 com calibração) |

**20 X1 na VPS de 4 GB** é meta de **desenho**, não de carga confortável nesta máquina. A VPS de ~10 GB / 5 vCPU é o alvo sério para 20.

## Anti-cheat (o que não negociamos)

- Cliente **não** executa o core da partida APOSTADO
- Sem VENCI/PERDI / REPORT do cliente
- Resultado só por observer/server
- Modo juiz no PC do jogador = só amistoso (fora deste plano)

## Env

```bash
HOSTED_ENGINE=native          # chrome | native
HOSTED_MAX_SESSIONS=6         # calibrar após carga
HOST_BOT_BIN=                 # binário real; vazio = stub de lab
HOST_BOT_ARGS=
HOST_BOT_KIND=                 # retroarch | (vazio)
HOST_BOT_WORKDIR=data/hosted/kof2002
HOST_BOT_ROM=                 # default: workdir/kof2002.zip
HOST_BOT_CORE=fbneo_libretro
HOST_BOT_APPENDCONFIG=scripts/host-bot-lua/retroarch-lab.cfg
```

## Primeiro teste (VPS 4 GB)

```powershell
cd arcade-rgc-platform
git pull
npm ci
$env:HOSTED_ENGINE="native"
npm run smoke:host-bot -- 4
npm test
```

- `smoke:host-bot 4` sobe **4** Host Bots stub (sem Chrome) e reporta RSS.  
- Esperado: `phase: "ok"` em poucos segundos.  
- Fase 1: input mapeado + samples sintéticos → `observeSample`.

## Fora de escopo desta fase

- PIX real, segundo jogo, tema/layout
- Encode/WebRTC (Fase 2)
- Frota multi-VPS (vem depois dos 20 estáveis em uma máquina)
