# Arena Arcade — versão de teste local

Esta versão integra salas, convites, duas contas, carteira com reservas identificadas e preparação do KOF 2002 original. Os créditos do teste não têm valor monetário. PIX real e operação comercial não estão liberados.


## Temas visuais (escolha)

Abra `/theme-gallery.html` para comparar **20 identidades autorais** (vitrine, sala, perfil, admin).
O ID escolhido é salvo em `localStorage.arena.theme` e aplicado via `/theme-apply.js`.

Painel operacional redesenhado: `/admin.html` (cargos MASTER → GUEST).

## Hardening KOF 2002 (esta entrega)

Correções focadas no KOF sem ativar PIX real nem Bomberman:

- Carteira única SQLite (`finance.js`); `escrow.js` só calcula rake
- Rake da sala respeitado no accept
- Partida em revisão (`DISPUTE`) não liquida automaticamente
- Fila `HOSTED_QUEUED` quando o servidor hosted está cheio
- Rate limit HTTP 60/min, lockout de login, `ADMIN_IP_ALLOWLIST`
- Torneios/matchmaking automático sem débito fantasma; PIX real continua off

```powershell
npm ci
npm test
npm run test:local
```

## Executar

Requer Node.js 22 ou superior (validado localmente com Node 24).

```powershell
npm ci
npm run setup:emulator
npm test
npm run test:local
```

Abra `http://127.0.0.1:3001` em dois navegadores ou em janelas com sessões separadas. Use exatamente o mesmo endereço nas duas janelas. `localhost` e `127.0.0.1` são origens diferentes para arquivos salvos no navegador.

O comando de teste cria `data/arena-test.db`. Se existir `data/arena.db`, faz uma cópia consistente somente na primeira execução; as migrações e os testes manuais usam a cópia. O banco original não recebe as movimentações desse teste. Novas contas de teste recebem 2000 centavos fictícios, com lançamento de origem. Não crie uma segunda instância apontando para o mesmo banco.

`npm start` usa a configuração normal e o banco definido em `DB_PATH`; não equivale ao comando de demonstração. Para criar a primeira conta admin, defina `ADMIN_PASSWORD` e, opcionalmente, `ADMIN_EMAIL`. Contas existentes preservam a senha. Não existe nova senha administrativa padrão.

## Execução oficial e interface v13

A interface e o backend agora têm atualização v13: vitrine responsiva, carregamento por etapas reais, configuração de joystick/teclado, comprovante de resultado e backup/restauração em arquivos novos. Veja **docs/UPGRADE-V13.md** para uso, validação e estado das 30 melhorias. Reinicie o servidor e atualize os navegadores após terminar a partida em andamento.

Desafios com créditos de demonstração agora exigem uma sessão no computador do servidor; ambos recebem vídeo e enviam controles. O resultado é coletado pelo observador privado do KOF, sem VENCI/PERDI. Prepare os arquivos com `npm run setup:hosted -- --rom "caminho/kof2002.zip" --bios "caminho/neogeo.zip"`. Requer Edge no Windows ou navegador Chromium configurado. O limite inicial é uma sessão. Consulte **docs/HOSTED-GAMES.md** para configuração, evidências e limites.

Escolha **Grátis — execução local** no seletor para continuar no modo amistoso anterior, sem reservar saldo. Os ZIPs selecionados no navegador são usados apenas nesse fluxo. A configuração hospedada usa cópias privadas no servidor e não fornece download aos jogadores.

## Duelo grátis local

1. Cadastre ou autentique uma conta diferente em cada janela.
2. Clique em **Salas de Duelo** e escolha a mesma sala KOF 2002.
3. Escolha Grátis — execução local, desafie o outro jogador e aceite o convite na outra janela.
4. O jogador 1 seleciona `kof2002.zip` e `neogeo.zip`. Os arquivos ficam no IndexedDB dele; não são enviados ao servidor. O jogador 2 recebe imagem/som da mesma instância e envia o controle remoto.
5. Se a validação indicar BIOS incompatível, selecione outra BIOS compatível. Renomear outro arquivo não corrige o conteúdo. O botão Sair cancela a preparação e devolve as duas reservas.
6. Quando ambos estiverem conectados, use FICHA/START se o modo do jogo exigir; selecione os times **dentro do próprio KOF**.
7. Teclas: setas para direção, Z/X/A/S para os quatro golpes e Enter para Start. No amistoso local, 5 insere ficha; no modo servidor, as fichas são preparadas automaticamente. Cada navegador controla o respectivo slot. P2 pode clicar em ATIVAR SOM.
8. No amistoso local, ambos confirmam VENCI/PERDI, sem movimentar crédito. Nos desafios hospedados, o observador privado coleta a vitória do confronto completo; o navegador não declara vencedor.

Exemplo: saldo inicial de 2000 centavos para cada jogador, stake de 500 e rake de 100 centavos. Após confirmação, vencedor fica com 2400; perdedor com 1500; receita de teste da plataforma recebe 100. O stake já saiu do disponível ao aceitar; não é debitado novamente no encerramento.

## ROM e BIOS

O carregador verifica a estrutura do ZIP e os CRCs declarados de todos os componentes do romset original. O core faz sua própria verificação ao carregar. Não é um mecanismo de prova do resultado nem de proteção contra cliente alterado.

A BIOS precisa conter componentes compatíveis com o core FBNeo instalado, incluindo:

| Componente | Tamanho | CRC32 |
|---|---:|---|
| sm1.sm1 | 131072 | 94416d67 |
| sfix.sfix | 131072 | c2ea0cfd |
| 000-lo.lo | 131072 | 5a86cff2 |

Também precisa de uma BIOS de sistema reconhecida. O conjunto antigo encontrado em Downloads era incompatível; o novo neogeo.zip de 1.950.045 bytes foi validado com o core. O instalador não fornece ROM ou BIOS.

EmulatorJS 4.2.3 e o core são servidos localmente em `public/emulatorjs/data`, instalados a partir do CDN oficial. O manifesto registra tamanho e SHA-256 de cada arquivo. Confira as condições das licenças do core e do jogo antes de qualquer uso comercial; instalar assets não concede direitos de exploração.

## Comportamento financeiro e de sessão

- Cada reserva pertence a uma partida ou saque. Eventos financeiros geram lançamentos balanceados e transacionais.
- Saques negativos, zero, fracionários ou enviados como texto são recusados.
- Aprovar/rejeitar novamente o mesmo saque com a mesma decisão é idempotente; mudar a decisão após encerramento é recusado.
- Sessões consultam o papel e o bloqueio atuais. Logout revoga o token. Uma conta tem uma conexão ativa por vez.
- Convites têm emissor, destinatário, valor, expiração e consumo único no servidor.
- Reconexão de WebSocket tem 30 segundos de tolerância. Antes de RUNNING, perda definitiva devolve reservas; depois de RUNNING, abre revisão sem estorno imediato.
- Recarregar toda a página do host perde o estado da emulação. O encerramento segue a regra da fase acima; reconexão de rede mantendo a página pode recuperar a sessão.
- Preparação tem prazo de três minutos; relato único de resultado tem prazo de um minuto. Falta de confirmação ou divergência após início abre revisão e preserva as reservas.
- A página **Revisões** mostra casos do jogador ou, para administrador, a fila e decisões. Somente admin pode estornar ou atribuir vitória, com justificativa/evidências de 20 a 1000 caracteres. Essa decisão é manual e não certifica o KOF.
- O prazo de revisão padrão é 24 horas (`MATCH_REVIEW_MS`). Sem decisão até o prazo, o sistema estorna sem declarar vencedor. Ainda pode haver abuso de disputas; execução confiável e evidência do resultado continuam pendentes.
- Revisões persistem com reservas após reinício. Partidas ativas fora de revisão são recuperadas com estorno após perda do processo; esta recuperação ainda não preserva a emulação.
- `/api/admin/reconciliation` mostra divergências entre saldos, lançamentos e reservas. Valores legados sem lastro ou reservas identificáveis exigem conciliação; não são apagados automaticamente.

## Validação realizada e pendências

### Integridade v11

Seis melhorias: snapshot imutável de regras de plataforma por partida; eventos persistidos com sequência e cadeia SHA-256; protocolo de comandos numerados e epoch por conexão; validação de botão/estado/direções e porta definida pela sessão para P1/P2; falha antes do início diferenciada de interrupção após início; revisão persistente com prazo, administração e decisão financeira idempotente.

P1 e P2 enviam comandos ao servidor; apenas os eventos aceitos são aplicados pelo host. O protocolo rejeita replay, epoch antigo e tentativa de escolher slot. As regras fixam prazos, controles e cancelamento da plataforma; ainda não garantem opções internas do core em um navegador adulterado. A cadeia de eventos restringe alterações pela aplicação, mas não protege contra um administrador que controle o banco e o servidor.

`npm test`: 40 testes aprovados. O fluxo de navegador validou KOF real, vídeo, comandos dos dois slots e revisão seguida de estorno pela UI administrativa. O teste de liquidação por confirmação usa fixture visual separada, identificada no relatório.

`npm test` cobre autenticação/autorização, paths, convites, rollback com falha induzida, liquidação, saques repetidos/negativos, expiração, reconexão, crash e validação de ROM/BIOS.

Dois contextos isolados do navegador validaram a UI, WebRTC e comandos dos dois jogadores chegando ao KOF real, que abriu e mostrou o tutorial. A liquidação por confirmação foi validada separadamente com imagem de teste. **Ainda falta concluir uma luta real.**

Na v10.1 foi corrigida a instalação da BIOS: o caminho externalFiles do EmulatorJS 4.2.3 criava um ZIP de zero bytes. A gravação agora usa Uint8Array antes da ROM e verifica o conteúdo lido. O evento start só libera a partida se o core produzir um estado de máquina válido; a tela de erro do FBNeo retorna estado vazio e é bloqueada. A regressão inclui 27 testes e reprodução da falta de BIOS no navegador.

Na v12 foram concluídas lutas reais em execução privada no servidor, com observação de vitórias de ambos os slots em testes separados. O teste de dois navegadores validou o resultado oficial e a distribuição dos créditos fictícios. Ainda faltam validação em duas redes reais, áudio percebido, casos extremos do detector e dimensionamento de infraestrutura. Amistosos preservam o transporte anterior; não há rollback GGPO implementado.

Torneios, clãs, replays, espectadores e demais funcionalidades identificadas na análise continuam com as limitações documentadas; não foram certificados por este lote de correções.
