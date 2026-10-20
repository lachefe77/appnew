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
| **1** | Bot Windows: spawn + input + sample de estado | 1 X1 lab sem Playwright |
| **2** | Encode leve + WebRTC/LiveKit para 2 peers | Paridade visual mínima (ex. 320p30) |
| **3** | Capacidade medida na VPS 4 GB | Relatório N partidas estáveis ≥ 10 min |
| **4** | `HOSTED_MAX_SESSIONS` calibrado + fila | Meta teste 5–8; desenho 20 |
| **5** | VPS 10 GB / 5 vCPU | Validar 20 X1 com folga |

## Fase 1 (atual) — sample sem Chrome

### O que entra

| Peça | Papel |
|---|---|
| `Kof2002Observer.observeSample` | Mesma máquina de estados do Chrome; **sem** RASTATE/EJS |
| `native-input-map.js` | Botão Arena → tecla / bind RetroArch |
| `native-host-launcher.js` | Monta cmdline stub ou RetroArch/FBNeo |
| `scripts/native-host-worker.js` | Emite `event:"sample"` (sintético no stub) |
| `scripts/host-bot-lua/kof2002-reporter.lua` | Lê RAM peon2/Fightcade → `ARENA_SAMPLE {json}` |

### Por que Lua e não savestate nativo

O perfil `kof2002-ejs423-legacy-v1` depende do snapshot EmulatorJS (414144 bytes, `ramOffset 0x3064c`). Savestate RetroArch/FBNeo **não** tem o mesmo layout. O Lua emite health/timer/wins já decodificados; o Node chama `observeSample`.

### Protocolo JSONL (extensão Fase 0)

```text
→ { "cmd":"start"|"input"|"pause"|"resume"|"stop"|"injectSample"|"injectResult", ... }
← { "event":"sample", "sample": { "frame", "health":[h1,h2], "timer", "wins":[w1,w2] } }
```

### Teste no PC Windows (PowerShell)

```powershell
cd arcade-rgc-platform
git fetch
git checkout cursor/host-bot-nativo-4ff7
npm ci
$env:HOSTED_ENGINE="native"
npm run smoke:host-bot -- 1
npm test -- tests/host-bot.test.js
```

Esperado no smoke: `phase: "ok"`, `manifest.phase: 1`, samples no fluxo.

Com RetroArch instalado (opcional, ainda sem vídeo):

```powershell
$env:HOSTED_ENGINE="native"
$env:HOST_BOT_BIN="C:\caminho\retroarch.exe"
$env:HOST_BOT_KIND="retroarch"
$env:HOST_BOT_WORKDIR="data/hosted/kof2002"
# Fase 1 ainda usa o worker Node para IPC; o bin fica documentado no launch.
npm run smoke:host-bot -- 1
```

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
