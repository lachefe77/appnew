# HANDOFF — Arena Arcade (abrir novo chat com isto)

**Data:** 2026-10-20  
**Repo:** `lachefe77/appnew` · pasta do app: `arcade-rgc-platform/`  
**Branch ativa do trabalho:** `cursor/sistema-1a9-85f1`  
**PR:** https://github.com/lachefe77/appnew/pull/4  
**Base:** `main`  
**Negócio:** fliperama online KOF 2002 (crédito fictício). PIX real OFF. Bomberman OFF. Tema/layout CONGELADO.

---

## Como continuar (cole no novo chat)

```
Continue o Arena Arcade em arcade-rgc-platform na branch cursor/sistema-1a9-85f1
(PR https://github.com/lachefe77/appnew/pull/4).

Leia HANDOFF-NEXT-CHAT.md e CONTEXT.md.

CONCLUÍDO: melhorias 1–30 (partida hosted + estabilidade/escala/CI).
PRÓXIMO: hillclimb / beta fechado / infra TURN real / container isolation em VPS.
NÃO gastar tempo com tema/layout/vitrine. PIX real e segundo jogo continuam OFF.
Responda em português.
```

---

## O que já foi feito (1–9) — NÃO refazer

| # | Entrega | Onde |
|---|---|---|
| 1 | Reset observador entre games Bo3/Bo5 + liquidação de série | `kof2002-observer.js` `resetForNextGame`, `platform.js` `applyGameResult` |
| 2 | Time-over, double KO, wins incoerentes → review | `kof2002-observer.js` |
| 3 | TURN efêmero no `HOSTED_READY` + cliente usa `iceServers` | `turn-credentials.js`, `platform.js`, `fbneo-loader.js` |
| 4 | Bitrate/FPS adaptativo | `hosted-worker.js` |
| 5 | Reconnect reenvia `HOSTED_READY` sem matar worker | `platform.js` REAUTH |
| 6 | Screenshot CDP na review | `hosted-session.js` `captureEvidence`, `match_reviews.evidence` |
| 7 | Limite diário no ACCEPT (já existia) + teste | `UserLimits` + `tests/sistema-1a9-child.js` |
| 8 | `recoverMatches`: REVIEW fica; LOADING/QUEUED estorna | `finance.js` + teste child |
| 9 | Fila `placeInQueue` + `etaSeconds`; cancel QUEUED estorna (bugfix) | `platform.js` |

---

## O que já foi feito (10–30) — NÃO refazer

| # | Entrega | Onde |
|---|---|---|
| 10 | Ready-check P1+P2 ACK → countdown → RUNNING | `ready-check.js`, overlay `#readyCheckOverlay`, `READY_ACK` |
| 11 | Placar Bo3/Bo5 + métricas HUD alinhadas | `SCOREBOARD_UPDATE`, normalização rttMs/packetLoss/fps |
| 12 | Rematch 1-clique (REMATCH_OFFER/AVAILABLE/ACCEPT) | `platform.js` + cliente index.html |
| 13 | Perfil de controle na conta (SQLite) | `control_profiles`, `/api/me/controls`, sync em `controller-settings.js` |
| 14 | Anti stuck-button (visibilitychange/pagehide) | `fbneo-loader.js` |
| 15 | Latência comando→imagem | `command-latency.js`, `LATENCY_SAMPLE`, `requestVideoFrameCallback` |
| 16 | Wallet 3 buckets (disponível/reservado/disputa) | `walletView` + UI carteira |
| 17 | Replay/input journal persistente (JSONL) | `replays.js` + `REPLAY_DIR` |
| 18 | Health → webhook Slack/Telegram | `alerts.js`, `check-health.js` + `ALERT_WEBHOOK_URL` |
| 19 | Backup off-box (local + cp/comando remoto) | `scripts/offbox-backup.js`, `npm run db:offbox` |
| 20 | Tutorial prefs (step/done) na conta | `user_prefs`, `/api/me/tutorial` |
| 21 | Find-match região + RTT | `MatchmakingQueue` region/rtt_ms |
| 22 | Áudio: stream tracks + ATIVAR SOM estável | worker `getTracks`/`addTrack`, loader unmute |
| 23 | Multi-sessão: cap + isolamento por worker Playwright | `/api/ops/hosted-cap` (container/cgroup = gap VPS) |
| 24 | Warm pool | `warm-pool.js`, `HOSTED_WARM_POOL` |
| 25 | Espectador read-only | `SPECTATE_JOIN` / `SPECTATE_STARTED` |
| 26 | PaymentProvider mock (PIX real 409) | `payment-provider.js` |
| 27 | Freeroll 8 jogadores (crédito fictício) | `freeroll.js`, `/api/freeroll/*` |
| 28 | MFA admin TOTP em settle/saque/role | `admin-mfa.js`, `MFA_ENFORCE` |
| 29 | Histórico de partidas no perfil | `MatchHistory`, `/api/me/matches`, `perfil.html` |
| 30 | E2E partida 100% | `tests/partida-100-child.js` |

**Testes:** `npm test` → **104 pass** (inclui `sistema-1a9` + `sistema-10a30`).  

**Gaps de infra externa (documentados, não bloqueiam o lote):**
- TURN coturn real em produção (`TURN_URLS`/`TURN_SECRET`)
- Cópia remota S3/SCP dedicada (`BACKUP_REMOTE_CMD`)
- Isolamento por container/cgroup em VPS (hoje: processo Playwright por sessão)

**Tema:** WIP Neo Geo em stash `tema-wip-pause` — **não priorizar**.

---

## Arquitetura rápida

- Entrada: `server/index.js` → `platform.js` (HTTP/WS/salas/matches)  
- Dinheiro: `finance.js` + SQLite (`db.js`)  
- Hosted: `hosted-session.js` + `hosted-worker.js` + `kof2002-observer.js`  
- Novos módulos 10–30: `ready-check.js`, `payment-provider.js`, `alerts.js`, `admin-mfa.js`, `warm-pool.js`, `freeroll.js`, `command-latency.js`  
- Cliente: `public/fbneo-loader.js`, `public/index.html`, `public/perfil.html`  

## Comandos

```bash
cd arcade-rgc-platform
npm ci
npm test
npm run test:local   # http://127.0.0.1:3001
npm run db:offbox
npm run health:check
```

Node ≥ 22. Créditos só com `NODE_ENV=development` + `ENABLE_SIMULATED_FUNDS=1`.

## Regras de produto (não violar)

- Sem PIX/dinheiro real  
- Sem Bomberman nesta fase  
- Sem confiar em VENCI/PERDI do cliente no modo APOSTADO  
- Sem anunciar “zero fraude”  
- Tema/layout: só se o usuário pedir explicitamente  
