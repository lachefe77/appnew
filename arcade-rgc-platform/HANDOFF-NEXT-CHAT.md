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

CONCLUÍDO: melhorias de sistema 1–9 (partida hosted 100% funcional).
PRÓXIMO: implementar 10–30 da lista abaixo, todas funcionais, com testes npm test,
commit/push na mesma branch (ou cursor/sistema-10a30-85f1) e atualizar o PR.
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

**Testes:** `npm test` → **84 pass** (inclui `tests/sistema-1a9.test.js`).  
**Env nova:** `TURN_URLS`, `TURN_SECRET`, `TURN_TTL_SEC`, `HOSTED_AVG_MATCH_SEC` (ver `.env.example`).

**Tema:** WIP de Neo Geo ficou em `git stash` nome `tema-wip-pause` — **não priorizar**. Design depois.

---

## Próximo: implementar 10–30 (nesta ordem)

### Estabilidade (10–22)
10. Ready-check sincronizado (overlay P1+P2 ACK → countdown → Start)  
11. Placar Bo3/Bo5 ao vivo oficial (HUD + eventos do observer)  
12. Rematch 1-clique mesmo stake/regras  
13. Perfil de controle na conta (SQLite, não só localStorage)  
14. Anti stuck-button + foco (Alt-Tab / painel controles)  
15. Métrica comando→imagem (latência percebida)  
16. Wallet UI: disponível / reservado / disputa  
17. Replay/input journal persistente (hoje `replays.js` é Map em memória)  
18. Health → alerta externo (webhook Slack/Telegram)  
19. Backup automático off-box (cron + cópia remota)  
20. Tutorial primeira partida jogável (wizard)  
21. Find-match com região + RTT  
22. Áudio estável nos dois lados  

### Escala (23–29)
23. `HOSTED_MAX_SESSIONS > 1` isolado (processo/container)  
24. Warm pool de worker  
25. Espectador read-only  
26. `PaymentProvider` mock (PIX continua 409 / off)  
27. Freeroll 8 jogadores (crédito fictício)  
28. MFA admin em settle/saque/role  
29. Histórico de partidas no perfil  

### CI (30)
30. Suite E2E “partida 100%”: challenge → hosted → observer win → settle → conciliação  

---

## Arquitetura rápida

- Entrada: `server/index.js` → `platform.js` (HTTP/WS/salas/matches)  
- Dinheiro: `finance.js` + SQLite (`db.js`)  
- Hosted: `hosted-session.js` + `hosted-worker.js` + `kof2002-observer.js`  
- Integridade: `match-integrity.js` (rules, events, reviews)  
- Cliente partida: `public/fbneo-loader.js`, `public/index.html`  
- Docs: `README.md`, `docs/HOSTED-GAMES.md`, `docs/UPGRADE-V13.md`

## Comandos

```bash
cd arcade-rgc-platform
npm ci
npm test
npm run test:local   # http://127.0.0.1:3001
```

Node ≥ 22. Créditos só com `NODE_ENV=development` + `ENABLE_SIMULATED_FUNDS=1`.

## Regras de produto (não violar)

- Sem PIX/dinheiro real  
- Sem Bomberman nesta fase  
- Sem confiar em VENCI/PERDI do cliente no modo APOSTADO  
- Sem anunciar “zero fraude”  
- Tema/layout: só se o usuário pedir explicitamente  

## Critério de pronto do próximo lote

- Itens 10–30 implementados ou com gap documentado só se bloqueado por infra externa (TURN real, S3, etc.)  
- `npm test` verde  
- Commit + push + PR atualizado  
- Resumo em PT: antes → depois → impacto  
