# Atualização v13

Vitrine redesenhada, carregamento por eventos reais, configuração de controles, comprovante e ferramentas de operação. A atualização amplia a demonstração local; não certifica operação pública nem ausência total de fraude.

## Carregar a atualização

Termine a partida atual ou siga a revisão prevista antes de reiniciar. No terminal do servidor, Ctrl+C e:

```powershell
cd "C:\Users\Pc Gamer\Documents\arcade-rgc-platform"
npm run test:local
```

Abra http://127.0.0.1:3001/ e pressione Ctrl+F5 nos dois navegadores. /health deve informar version 13.0. Se a porta estiver ocupada, não inicie uma segunda instância com o mesmo banco.

O banco original não foi substituído. test:local usa data/arena-test.db. O processo v12 que estava com uma partida ativa foi mantido durante a atualização.

## Joystick

1. Conecte o USB ou faça o pareamento Bluetooth no sistema operacional.
2. Na vitrine, clique Testar meu controle; também há CONTROLES dentro da partida.
3. Com a página em foco, pressione um botão para o navegador expor o controle.
4. Selecione o dispositivo. O padrão Gamepad API atende dispositivos que o navegador reconhece como standard, incluindo combinações compatíveis de Xbox e PlayStation.
5. Se não for standard ou os botões estiverem trocados, clique no botão de cada ação, solte os botões físicos e pressione a substituição. O número mostrado começa em 1.
6. Configure eixos e zona morta se necessário. O painel mostra os valores reais. Direcional digital e analógico são lidos; adaptadores que simulam teclado usam o remapeamento de teclado.
7. Concluir fecha a configuração. Preferências ficam neste navegador e por identificador do controle. O teste não envia comandos de jogo enquanto o painel está aberto.

Não foram instalados drivers do sistema ou aplicativos de terceiros. PS4, Xbox e arcade físicos ainda exigem verificação com os dispositivos do usuário; não confundir o teste automatizado de Gamepad API com teste de hardware. Um identificador de modelo pode ser igual em dois controles idênticos; selecione apenas um dispositivo desse modelo por navegador nesta versão.

## Carregamento

As etapas indicam integridade dos arquivos, preparação do emulador, conexão de vídeo e prontidão dos jogadores. Uma barra animada significa espera, não porcentagem estimada. Após 30s há uma orientação adicional, sem cancelar a partida ou estornar automaticamente. Falha de carregamento continua sujeita à fase e às regras já existentes. No modo local, o formulário de ROM/BIOS permanece acessível.

Tela cheia inclui a barra de ações. NITIDEZ alterna a escala pixelada do vídeo, não aumenta sua resolução original ou remove artefatos de compressão. ATIVAR SOM continua exigindo interação do jogador.

## Backup e diagnóstico

```powershell
npm run db:backup
npm run db:verify -- "data/backups/arquivo.db"
npm run db:restore -- "data/backups/arquivo.db" "data/arena-restored.db"
npm run health:check
```

Backup padrão: data/arena-test.db para um arquivo novo em data/backups. Informe a origem explicitamente para outros bancos. A restauração só cria um arquivo novo; pare o servidor e configure DB_PATH antes de usá-lo. Nunca substitui o banco em execução. Guarde backups fora da máquina de operação com controle de acesso; agendamento e alertas externos não foram configurados.

## Estado das 30 melhorias

| Nº | Entrega | Estado desta atualização |
|---|---|---|
| 1 | Configuração de teclas | Implementada, salva no navegador |
| 2 | Teste visual dos comandos | Implementado, teclado e joystick |
| 3 | Configuração de joystick | Implementada; falta teste nos modelos físicos |
| 4 | Tutorial inicial | Guia na vitrine e ajuda atualizada; tutorial interativo ainda pendente |
| 5 | Foco e botões presos | Liberação e aviso implementados; joystick não reaplica enquanto sem foco |
| 6 | Tela cheia | Implementada no toolbar atual |
| 7 | Duas redes reais | Pendente: dois dispositivos e redes externas |
| 8 | Atraso comando até imagem | Pendente; ACK/RTT existentes não medem isso |
| 9 | Qualidade da conexão | Painel de FPS decodificados, perda no intervalo e jitter implementado; mantém RTT/ACK existentes e avisa ausência de novos quadros |
| 10 | Vídeo adaptativo | Pendente; bitrate atual fixo no worker |
| 11 | Nitidez | Alternância de escala implementada; comparação de codecs/resolução pendente |
| 12 | Áudio | Botão de ativação existente; validação perceptiva externa pendente |
| 13 | TURN temporário | Pendente: infraestrutura TURN e emissão de credenciais |
| 14 | Comprovante | Implementado a partir do evento autenticado do servidor |
| 15 | Histórico detalhado | Histórico/revisões existentes; recibo persistente com todos os detalhes ainda pendente |
| 16 | Casos extremos do resultado | Testes sintéticos de KO intermediário, empate incoerente e contador existem; matriz real completa pendente |
| 17 | Reconexão completa | Protocolo/testes existentes; matriz de queda real de mídia/rede ainda pendente |
| 18 | Abandono | Regras de reserva/revisão existentes; explicação prévia mais completa pendente |
| 19 | Evidências | Eventos no servidor e revisões existentes; captura audiovisual de evidência pendente |
| 20 | Replay verificável | Não implementado; journal de inputs não equivale a replay validado |
| 21 | Isolamento público | Worker separado existente; container/limites de SO em VPS pendentes |
| 22 | Fila de capacidade | Limite de sessões existente; fila com espera e admissão pendente |
| 23 | MFA administrativo | Pendente |
| 24 | Detecção de anomalias | Validação de protocolo existente; detector comportamental pendente |
| 25 | Testes contra fraude | Suíte ampliada para 65; não é auditoria exaustiva nem garantia contra toda invasão |
| 26 | Backup e restauração | Implementados e testados em cópias; retenção/agendamento externo pendentes |
| 27 | Monitoramento | Comando de saúde implementado; alertas persistentes externos pendentes |
| 28 | Beta fechado | Interface identifica beta; convites/controle de admissão ainda pendentes |
| 29 | Preparação pública | Licenças, privacidade e meios de pagamento exigem trabalho adicional; dinheiro real continua bloqueado |
| 30 | Custo por partida | Métricas parciais de runtime existentes; medição integral e orçamento de VPS pendentes |

## Evidência desta rodada

- npm test: 65 aprovados.
- Edge automatizado: layout 1440 e 390px; sem overflow horizontal; teclado remapeado para V e persistido após reload; arcade simulado remapeado para botão 6; comando chegou ao transporte; texto do recibo não cria HTML.
- KOF real privado: dois clientes de vídeo, zero emuladores locais, etapas reais recebidas, loader removido após prontidão, Start e golpes nos dois slots com ACK. Não repetiu uma vitória completa nesta rodada.
- Backup e restauração da base de teste em arquivos novos: cinco carteiras, integridade SQLite e conciliação válidas. Nenhuma restauração sobre o banco ativo.
