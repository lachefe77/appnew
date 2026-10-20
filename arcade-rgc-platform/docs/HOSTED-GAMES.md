# Execução oficial local — v12

## Modos

- **Grátis:** escolha "Grátis — execução local" no seletor do desafio. Mantém o fluxo anterior de ROM/BIOS no navegador P1 e streaming para P2. Não reserva saldo.
- **Com créditos fictícios:** exige um worker no computador do servidor. Ambos recebem vídeo/áudio; nenhum recebe ROM/BIOS ou acesso ao runtime do jogo. O enum interno legado é APOSTADO; a interface apresenta desafio com créditos.

PIX real, operação financeira comercial e exploração comercial do core não são habilitados por essa implementação. O core da prova continua FBNeo/EmulatorJS; as restrições de licença permanecem e não foram contornadas.

## Preparar no Windows

Node 22+, Edge instalado e arquivos do próprio usuário. O projeto usa playwright-core; não baixa outro navegador automaticamente.

```powershell
npm ci
npm run setup:emulator
npm run setup:hosted -- --rom "C:\caminho\kof2002.zip" --bios "C:\caminho\neogeo.zip"
npm test
npm run test:local
```

O setup valida os componentes e copia os dois ZIPs para `data/hosted/kof2002`, fora de public. O manifesto registra SHA-256 dos ZIPs e dos assets instalados do runtime. A prova usa somente o KOF 2002 original. Reinstalar ou alterar runtime exige preparar/aprovar o manifesto novamente. Não editar os arquivos privados enquanto houver sessão ativa.

`test:local` continua usando data/arena-test.db. Nunca inicie dois servidores apontando para o mesmo banco.

Abra http://127.0.0.1:3001/ em dois navegadores, entre com duas contas e desafie usando créditos fictícios. Aguarde o boot e os dois vídeos. Clique START nos dois navegadores, selecione os times e a ordem dentro do KOF. As fichas do gabinete são preparadas pelo servidor. Elas não são o saldo da carteira. Movimento: setas; quatro golpes: Z/X/A/S; Enter: Start. A tecla 5 e o Select do controle não enviam ficha no modo servidor. No amistoso local, 5 insere ficha. Teclado e controle podem manter o mesmo botão pressionado sem que soltar um deles solte o outro. Direções opostas usam a última pressão; perder o foco libera os botões.

Não existem VENCI/PERDI no desafio hospedado. A derrota de um personagem não encerra a partida. Após vitória sobre o time completo, o observador da sessão oficial comunica o vencedor ao financeiro, que liquida uma vez. Se houver falha ou informação incoerente, não inventa vencedor: aplica cancelamento antes do início ou revisão após início.

## Componentes

- `server/hosted-assets.js`: valida arquivo privado e runtime aprovado.
- `scripts/setup-hosted-game.js`: provisionamento local, sem baixar ROM/BIOS.
- `server/hosted-session.js`: navegador separado, contexto efêmero, fila limitada, binding privado e servidor HTTP exclusivo em loopback com segredo.
- `server/hosted-worker.js`: captura de áudio/vídeo, dois peers WebRTC, aplicação de controles e métricas. Não é servido na aplicação pública.
- `server/kof2002-observer.js`: perfil de leitura de memória para o build exato instalado.
- `server/platform.js`: identidade, reserva, capacidade, ciclo de vida, sinalização, validação de inputs e liquidação.

O frontend público não consegue enviar uma mensagem que represente o resultado do worker. REPORT_MATCH_RESULT e ofertas de vídeo vindas do cliente são recusados nesse modo. Start/controles continuam comandos não confiáveis e são validados. O jogador não seleciona slot, core, ROM, arquivos, cheat ou código para executar.

O worker inicia com configurações fixadas de velocidade, patches, diagnóstico e modo Neo Geo. As versões são aprovadas pelo operador. Cada partida recebe um navegador/contexto separado; isso não substitui isolamento por usuário/container no futuro host público.

## Detector

O perfil `kof2002-ejs423-legacy-v1` depende de EmulatorJS 4.2.3 + core FBNeo legacy aprovado, estado serializado de 414144 bytes e posição de RAM validada nessa versão. Mudança de layout ou retrocesso do relógio bloqueia a interpretação. NÃO reutilizar o perfil em MAME, Magic Plus, outro core ou romset.

Referências de endereços:

- https://github.com/fightcadeorg/fightcade-detectors/blob/main/kof2002.inf — timer e contadores de confronto na área raw 68K RAM.
- https://github.com/peon2/fbneo-training-mode/blob/master/games/kof2002/kof2002.lua — endereços de saúde na CPU.

O observador exige sessão armada pelo servidor, Start de ambos, combate observado e contador de confronto incrementado de modo consistente em três amostras com avanço de quadros. Não usa texto da tela, KO isolado ou declaração do jogador. Em testes reais separados, movimentos/golpes normais produziram vitórias completas de P1 e P2; o teste integrado também exercitou a liquidação automática de P1.

Essa validação não certifica todas as condições do jogo. Empates, resets, interrupções e situações ambíguas precisam continuar sujeitos a testes e revisão, com detector falhando sem pagar por suposição. Há testes sintéticos da máquina de estados, identificados como sintéticos; os testes financeiros usam worker fixture privado via IPC e não comprovam emulação.

## Métricas e capacidade

A interface mostra bitrate observado, RTT de mídia, tempo de confirmação de comandos e quadro do core. O último inclui ida ao servidor, aplicação e ACK; não mede o atraso completo do botão até a imagem.

`HOSTED_METRICS` também registra bytes enviados, quadros codificados e tempo de codificação por peer; ocupação da thread principal do worker e heap JavaScript são métricas parciais. Não representam toda a CPU, RAM, WASM, GPU ou custo da máquina. O limite inicial é uma sessão hospedada por servidor (`HOSTED_MAX_SESSIONS=1`).

Os testes com dois navegadores ocorreram no mesmo computador. Não determinam latência de duas redes reais ou capacidade de uma VPS. Próxima validação exige dois dispositivos/redes, servidor próximo aos jogadores e medição de qualidade sob carga controlada. Não contratar GPU/VPS nem aumentar limite com base só no RTT local.

## Próximo host/VPS

- Instalar navegador compatível e configurar HOSTED_BROWSER_PATH quando necessário. No Linux, instalar Chromium e suas bibliotecas de sistema; não desativar o sandbox para contornar uma instalação incorreta.
- Configurar HTTPS/WSS e origens, portas de mídia e STUN/TURN conforme a rede. HOSTED_ICE_SERVERS é JSON para o worker. Credenciais TURN precisam de controle de validade/quota; não disponibilizar o serviço sem limites.
- Executar workers com privilégio mínimo, isolar arquivos por sessão e separar do banco/segredos de pagamento.
- Validar licenças do core, dependências e jogos antes de oferta pública/comercial. Este documento não concede direitos sobre eles.
- Manter dinheiro real bloqueado até validação financeira, operacional e jurídica adequada.

## Limites de proteção

Executar fora dos navegadores dos jogadores remove sua autoridade sobre a memória da partida oficial. Não impede macros, bots de visão, combinação de contas, roubo de credenciais ou exploração de falhas do servidor. O operador do servidor continua sendo parte confiável. Não anunciar proteção absoluta ou percentuais de segurança.
