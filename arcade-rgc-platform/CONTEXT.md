# Arena Arcade — contexto v13

## Hardening KOF (pós-v13)

- Carteira única via `finance.js` / SQLite. `escrow.js` só calcula rake (sem saldo em memória).
- Rake da sala (`rakePercent`) prevalece no accept de desafio APOSTADO.
- `openReview` marca `matches.status=DISPUTE`; settle automático bloqueado; admin/resolve usa `{ fromReview: true }`.
- Fila `HOSTED_QUEUED` quando `HOSTED_MAX_SESSIONS` está cheio; promove ao liberar slot.
- Rate limit HTTP alinhado a 60/min; lockout de login; `ADMIN_IP_ALLOWLIST` aplicado.
- PIX/saque real e torneios com buy-in continuam desabilitados. Foco: KOF 2002.
- `payload.simulation` reflete o ambiente real (`ENABLE_SIMULATED_FUNDS` + não-production).

## Atualização v13 — interface, carregamento e controles

- Vitrine substituída por interface responsiva própria em public/platform.css e public/portal.js. Apenas KOF disponível é anunciado; removidas promessas antigas de rollback/zero delay/PIX operacional. Dados online e partidas vêm de /health; falha deixa valores indisponíveis.
- Carregamento visível por etapas reais: HOSTED_PROGRESS (assets/runtime/boot/credits), HOSTED_READY, negociação WebRTC, primeiro vídeo e prontidão. Barra indeterminada, tempo e orientação após 30s; não inventa percentual nem certificação antifraude. A tela some somente com running e ready.
- public/controller-settings.js: teclado remapeável e persistido, seleção de dispositivo, perfil por identificador de joystick, botões remapeáveis, eixos e zona morta. Usa Gamepad API; não instala drivers nem garante modelos físicos sem teste. Controle arcade fora do mapping standard precisa calibrar/remapear. Teste visual não envia comandos à partida.
- Controles padrão: setas, golpes Z/X/A/S, Enter Start, 5 ficha somente no amistoso local. Bloqueio de ficha hospedada também no cliente, múltiplas fontes sem releases duplicados, liberação ao perder foco e ao configurar. Legenda acompanha remapeamento. Toolbar inclui tela cheia e nitidez (escala pixelada opcional, não aumenta resolução do vídeo).
- Comprovante visual de MATCH_ENDED usa os dados do servidor e textContent, sem aceitar resultado declarado pelo cliente.
- Painel de recepção mede FPS decodificados, perda de pacotes por intervalo e jitter via getStats; alerta ausência de novos quadros sem alterar resultado/carteira. Não mede atraso completo comando-imagem.
- scripts/database-backup.js: backup SQLite consistente, valida integridade, journal balanceado, carteiras e reservas; restauração sempre em arquivo novo. Não importa db.js nem roda migração ao inspecionar cópias. Comandos db:backup/db:verify/db:restore. scripts/check-health.js / health:check retorna falha por indisponibilidade ou conciliação incorreta; não há serviço de alertas externo configurado.
- 65 testes automatizados aprovados. Navegador: desktop 1440/mobile390 sem overflow; remapeamento/persistência e dispositivo USB simulado; carregamento/recibo seguros. Novo teste com KOF privado real: dois vídeos 320px conectados, zero iframes, loader oculto só após prontidão, Start e golpes com ACK nos dois slots. Esta rodada não repetiu liquidação natural de confronto completo nem teste em redes externas/controles físicos.
- Backup/restauração reais em cópias preservaram cinco carteiras conciliadas. Servidor local do usuário continuava v12 com uma partida ativa durante a entrega; não interrompido. Reiniciar manualmente após encerrar/revisar a partida ativa para carregar backend13.
- docs/UPGRADE-V13.md explica uso e o estado de cada uma das 30 melhorias autorizadas. Recursos externos e entregas ainda pendentes continuam identificados; esta atualização não implementa todas as 30 nem libera dinheiro real.

## Estado atual — execução oficial

Este bloco descreve a v12 e substitui as afirmações de arquitetura/resultado do histórico v11 abaixo. A prova é local, com créditos fictícios. Ver docs/HOSTED-GAMES.md.

- AMISTOSO: execução local anterior, sem reserva; opção Grátis no seletor de desafios.
- APOSTADO (enum interno legado, apresentado como desafio com créditos): obrigatório server-stream e autoridade server-session. Sem fallback para host do jogador, sem VENCI/PERDI e sem aceitar REPORT_MATCH_RESULT.
- Worker separado usa Edge headless no computador do servidor, contexto efêmero e HTTP privado em loopback com segredo. ROM/BIOS em data/hosted/kof2002, nunca servidas aos jogadores. Setup explícito: npm run setup:hosted -- --rom caminho/kof2002.zip --bios caminho/neogeo.zip.
- Runtime e ZIPs conferidos por SHA-256 no manifesto; configuração fixada. Cada jogador recebe vídeo/áudio e somente sua porta de controle, pelo protocolo numerado já implementado.
- HOSTED_MAX_SESSIONS padrão 1. Só KOF 2002 original tem perfil oficial nesta versão. Erro no setup/layout bloqueia ou cancela/revisa; não aceita jogo/resultado alternativo vindo do cliente.
- Observador kof2002-ejs423-legacy-v1 lê snapshot privado de 414144 bytes, RAM 0x3064c do build aprovado, endereços raw de timer/vitórias e saúde CPU com troca de bytes. Não portar offsets para outro core sem validar.
- Exige Start dos dois, combate observado, avanço de quadros e contador de confronto estável. KOs intermediários não pagam. Testes com comandos naturais reconheceram vitória completa de P1 e P2 separadamente.
- Teste integrado com dois navegadores: zero iframes/emuladores locais, dois vídeos 320px conectados, resultado falsificado recusado, vitória oficial de P1, saldo fictício 24.00/15.00 e receita 1.00 (inicial 20.00 por jogador, stake5.00), conciliação correta.
- 51 testes automatizados aprovados. Testes contábeis usam worker fixture por IPC, identificado como fixture e sem endpoint público; testes do observador incluem dados sintéticos e provas reais separadas.
- Métricas locais incluem bytes/quadros codificados, RTT, ACK de input, ocupação da thread principal e heap JS parcial. Não equivalem a latência de duas redes nem capacidade total de VPS.
- Ainda pendem: validação entre dispositivos/redes diferentes, áudio percebido, casos extremos do detector, carga e isolamento de infraestrutura pública, direitos/licenças e pagamentos reais. Não anunciar ausência total de fraude. Core da prova permanece FBNeo e suas restrições comerciais continuam.

## Histórico v11 (arquitetura anterior, preservado como referência)

Atualizado em 19/10/2026. O contexto v9 anterior está no backup da conversa. Este documento descreve o estado implementado e os limites efetivamente observados.

## Executar o primeiro teste

- Node >=22; validado com Node 24.
- `npm ci`
- `npm run setup:emulator`
- `npm test`
- `npm run test:local`
- Endereço: http://127.0.0.1:3001 nos dois navegadores, contas diferentes.
- `test:local` usa `data/arena-test.db`. Na primeira execução, faz backup consistente do `data/arena.db` para a cópia de teste, se existir. Movimentações manuais de teste não atingem o banco original.
- Créditos são fictícios. PIX real não implementado. Não certificar esta versão para operação comercial.

## Arquitetura atual

- `server/index.js`: entrada e shutdown.
- `server/platform.js`: HTTP, autenticação, salas, convites, estado de duelos e relay de controles/sinalização.
- `server/finance.js`: migração financeira, journal balanceado, reservas identificadas, liquidação, estornos, saques e conciliação.
- `server/db.js`: SQLite e modelos legados; sessão valida expiração por julianday e papel atual da conta.
- `public/fbneo-loader.js`: sessão hospedada por P1 e stream WebRTC para P2; controles remotos por WS autenticado.
- `public/emulator.html`: iframe de mesma origem, seleção local de ROM/BIOS e EmulatorJS.
- `public/rom-check.js`: estrutura ZIP e identificação por CRC dos componentes necessários.
- `server/match-integrity.js`: regras persistidas, eventos com cadeia SHA-256, controles numerados, revisões e decisões transacionais.
- `public/reviews.html` e `reviews.js`: consulta de revisões próprias e decisão administrativa com justificativa.
- `scripts/setup-emulatorjs.js`: instala EmulatorJS 4.2.3 e FBNeo legacy localmente; falha se faltar arquivo obrigatório.
- `tests/critical-flow.test.js` e `tests/rom-check.test.js`: regressão automatizada, executada por npm test.

## Fluxo de duelo

1. Cadastro/login; visitante não entra no roster de lutadores.
2. Ambos na mesma sala persistida.
3. SEND_CHALLENGE gera convite com UUID, remetente, destinatário, stake, modo e expiração.
4. ACCEPT_CHALLENGE aceita apenas challengeId válido; dados do cliente não redefinem o convite.
5. Financeiro cria partida e bloqueia ambos os stakes em uma transação. Fase LOADING.
6. P1 carrega ROM/BIOS; P2 recebe vídeo da mesma instância e envia seu controle.
7. Ambos GAME_READY -> RUNNING.
8. Resultado do primeiro teste é confirmado pelos dois participantes em VENCI/PERDI. Não existe detector automático de vitória do KOF validado.
9. Concordância liquida uma vez na demonstração. Antes de RUNNING, cancelamento/falha estorna. Depois do início, interrupção/divergência abre revisão com reservas preservadas. Admin decide com justificativa; sem decisão em 24h ocorre estorno sem atribuição de vitória.

## Integridade v11

- Seis entregas: regras de plataforma fixadas por partida; journal de eventos; comandos sequenciais por conexão; validação de estado/porta; encerramento diferenciado por fase; revisão persistida com prazo e UI admin.
- Protocolo de input 2: ambos enviam PLAYER_INPUT com epoch e seq. Servidor autoriza slot pela sessão e retorna REMOTE_PLAYER_INPUT com slot/epoch/seq para aplicação no host. Rejeita repetição, sequência errada, epoch antigo, botão fora da lista e direções opostas simultâneas. A nova página e o novo backend devem ser carregados juntos; Ctrl+F5 após atualização.
- Revisões ficam em match_reviews, fases em match_state. recoverMatches preserva fase REVIEW; expireReviews processa prazo e finance executa estorno/decisão uma vez. Decisão administrativa não é prova automática de jogo.
- match_rules é snapshot imutável e match_events contém seq/hash/previous_hash, com triggers contra UPDATE/DELETE. Isso não é proteção contra comprometimento integral do servidor/banco.

Não há duas emulações independentes sincronizadas nem rollback GGPO implementado para FBNeo. O canvas game-engine legado não é fallback do KOF nesta jornada.

## Arquivos fornecidos e correção de carregamento v10.1

- ROM: C:/Users/Pc Gamer/Downloads/kof2002.zip — componentes do original reconhecidos pelo preflight.
- BIOS: C:/Users/Pc Gamer/Downloads/neogeo.zip — nova versão de 1.950.045 bytes compatível, verificada em 19/10/2026.
- CRCs esperados: sm1.sm1=94416d67; sfix.sfix=c2ea0cfd; 000-lo.lo=5a86cff2, tamanho131072.
- A BIOS antiga tinha CRCs incompatíveis; a nova contém os CRCs esperados e sp-s3.sp1=91b64be3.
- Defeito adicional identificado: externalFiles do EmulatorJS 4.2.3 escreve ArrayBuffer no FS e cria neogeo.zip com zero bytes. A BIOS agora é instalada como Uint8Array no evento saveDatabaseLoaded, antes de carregar a ROM, e a leitura é comparada byte a byte.
- O evento start também ocorre na tela de erro do FBNeo. Antes de enviar GAME_READY, o carregador exige estado de máquina serializável. O erro reproduzido retorna "Size is zero", é bloqueado e envia GAME_FAILED para devolver reservas.
- Com os arquivos novos, o KOF abriu, passou por INSERT COIN e pelo tutorial. Dois navegadores receberam vídeo e comandos dos dois controles chegaram à instância real. Ainda não foi validada uma luta completa.
- Não obter ou distribuir ROM/BIOS automaticamente como parte do setup. O usuário fornece os arquivos.

## Validação concluída

- Fluxos financeiros e de autorização, falha induzida entre reservas, idempotência, restrição de paths, reconexão e crash passaram nos testes automatizados.
- Duas contas em contextos isolados de navegador entraram na mesma sala e receberam a mesma partida.
- Stream e input remoto também foram verificados com o KOF real. A liquidação por confirmação continua tendo teste separado com imagem de teste; isso não substitui uma luta completa.
- 40 testes automatizados passaram; teste de navegador com BIOS removida após instalação confirmou ausência de GAME_READY.
- Revisão de 19/10 acrescentou oito cenários: origem/rota WS, JSON inválido, visitante sem autorização, usuário sem admin, entradas de login/nick, payload excessivo, arquivos privados/cabeçalhos e produção com flag demo. npm audit não apontou vulnerabilidades conhecidas nas dependências npm consultadas; não cobre o core WASM.
- Migração na cópia preservou os quatro saldos existentes e conciliou.

## Limites que permanecem

- Completar uma luta real em dois navegadores; a BIOS compatível já foi fornecida e o carregamento corrigido.
- Validar captura de áudio, controles/latência no KOF e detector de resultado.
- Host modificado não é fonte confiável para dinheiro real; aposta com saldo só habilitada em demonstração (development + ENABLE_SIMULATED_FUNDS=1).
- Disputas/cancelamento/GAME_FAILED após RUNNING agora abrem revisão sem estorno imediato. Sem evidências conclusivas e execução confiável, análise manual e estorno por prazo ainda podem ser abusados; não liberar dinheiro real.
- A licença publicada do FBNeo restringe obtenção de lucro; resolver permissão comercial ou alternativa adequada, além dos direitos dos jogos e BIOS.
- TURN pode ser necessário fora da rede local.
- Recarga completa do host perde a emulação e cancela com estorno; reconexão de rede mantendo a página é outra situação.
- Torneios, clãs e replays mantêm as limitações da análise; GETs existentes foram preservados. Não considerar funcionalidades completas.
- SQLite legado pode conter indicadores financeiros históricos sem lastro completo; a migração registra posição de abertura, não inventa lançamentos retroativos.
- Licenciamento do core/jogos, enquadramento comercial e integração de pagamentos precisam ser resolvidos antes do lançamento.

Consulte README.md para o passo a passo e comportamento financeiro. Não reintroduzir senha administrativa padrão, saldo demo em produção, aceitação de desafio sem registro ou confiança em vencedor arbitrário do cliente.
