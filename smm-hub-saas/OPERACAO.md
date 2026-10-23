# Operação e validação

O código foi alterado localmente em `D:\Servidor Local\smm-hub-saas`. Os testes usam bancos temporários. A migração foi ensaiada sobre uma cópia consistente do banco existente; o banco original não foi migrado por esse ensaio. Pix e cripto reais não foram ativados. O estado das 100 recomendações distingue implementação local de itens parciais; esta entrega ainda não representa conclusão integral nem homologação em produção.

## Validação local

Use Node 22.5 ou superior; a validação desta máquina foi realizada com Node 24.19 e Chrome. Depois de instalar dependências, execute:

```powershell
npm ci
npm run build:assets
npm test
npm run test:e2e
npm audit
npm run test:capacity
```

O Playwright usa o Chrome instalado no Windows. Em Linux/CI, instale o Chromium com `npx playwright install --with-deps chromium`. O teste de capacidade cria servidor e banco separados; sua amostra curta não define a capacidade da VPS.

Para repetir o ensaio das migrações sem modificar o banco original:

```powershell
node scripts/validate-existing.cjs data.sqlite
```

## Preparação do ambiente

`npm run setup:env` cria um `.env` novo, sem sobrescrever um existente, com chaves aleatórias e recebimento financeiro desativado. O padrão gerado destina-se ao container: `DB_PATH=/app/data/data.sqlite`. Para executar diretamente no Windows, ajuste `DB_PATH` para o caminho absoluto do banco correto antes de iniciar. Não aponte inadvertidamente para outro banco vazio.

Configure `APP_PUBLIC_URL`, `CORS_ORIGINS`, e-mail do responsável e SMTP. Preserve `SETTINGS_ENCRYPTION_KEY`: ela protege integrações, fatores 2FA, chaves novas de provedores e dados da fila de e-mail. Perder a chave impede recuperar os dados cifrados. Não troque a chave sem um procedimento de recifragem e backup.

O setup não troca a senha das contas já existentes. Antes de publicar, faça backup e execute a rotação offline das credenciais legadas com a aplicação parada. Defina `LEGACY_OWNER_EMAIL` e `NEW_OWNER_PASSWORD` no ambiente do processo e execute `node scripts/rotate-defaults.cjs`. A senha deve ter entre 12 e 128 caracteres. O comando troca a senha e chave comercial do CEO, revoga sessões e suspende outras contas encontradas com as senhas padrão conhecidas. Não foi executado contra o banco original nesta validação.

Não use senhas padrão em membros restantes. Em produção, administradores, CEO e suporte precisam configurar 2FA no perfil e entrar novamente com o segundo fator para acessar suas áreas. Guarde os códigos de recuperação; cada um pode ser usado uma única vez. Um código TOTP já aceito não pode ser reaproveitado na mesma janela de tempo.

## Docker e proxy

O Docker não está disponível nesta máquina; a imagem e o Compose não foram executados aqui. A configuração prepara o app na rede interna, com SQLite em `./data` e sem publicar a porta 3000. Nginx usa o IP interno `172.30.90.3`, único proxy confiável do app. Caso a sub-rede seja alterada, atualize também o endereço confiável. Não use `TRUST_PROXY=true` indiscriminadamente.

Configure domínio e certificados em `certs/` antes de iniciar o Nginx. O Compose usa certificados existentes; ele não emite certificados automaticamente. O banco original da raiz não é copiado automaticamente para o volume `data/`: faça uma cópia consistente com `VACUUM INTO`, verifique a integridade e transfira esse backup para o caminho esperado com os serviços parados. Mantenha proprietário/permissões compatíveis com o usuário do container.

Mantenha somente uma implantação por arquivo SQLite local. Leases, transações e claims reduzem sobreposição entre processos no mesmo banco; isso não homologa SQLite em armazenamento de rede nem expansão horizontal entre VPSs.

## Backup e restauração

`npm run backup` usa `VACUUM INTO` e verifica a cópia. Defina `DB_PATH` para o banco correto e, opcionalmente, `BACKUP_DIR`. Faça também cópias protegidas das chaves de ambiente e da versão exata do código/imagem.

Para restaurar, pare a aplicação e os workers, configure `DB_PATH` e execute `node scripts/restore.cjs CAMINHO_DO_BACKUP`. A rotina verifica o arquivo, salva o banco anterior e recusa destinos com WAL/SHM não vazios. Não apague journals de um banco em uso. Reinicie uma versão do código compatível com o schema restaurado. Migrações versionadas aplicadas não devem ser editadas; crie outro arquivo incremental.

## Integrações financeiras e e-mail

A área de integrações do CEO permite preparar Mercado Pago e NOWPayments, com confirmação de senha e segredos cifrados. Campos secretos vazios preservam valores existentes; a leitura informa somente se estão configurados. Os métodos permanecem indisponíveis até a configuração correspondente estar completa.

Antes de receber valores reais, ainda é necessário homologar callbacks, referência do comerciante, moeda, valor, duplicidade, atraso, estorno e falhas de rede em sandbox/conta real. As rotas públicas de simulação estão bloqueadas. A implementação não habilita cartão nem boleto. Recebimento real Pix/cripto ficou fora da ativação desta etapa por solicitação do proprietário.

SMTP real não foi exercitado. O teste de e-mail monta mensagens sem rede. Configure host, porta, credenciais e remetente; confirme entrega e links de recuperação em um ambiente controlado. A fila mantém conteúdo cifrado, retentativas e estado de falha. Há diferenças entre uma mensagem enfileirada e uma entrega confirmada.

CAPTCHA pode usar Turnstile ou hCaptcha. Defina `CAPTCHA_PROVIDER`, chave pública e segredo correspondentes (`TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET` ou `HCAPTCHA_SITE_KEY`/`HCAPTCHA_SECRET`). O backend rejeita token ausente; o widget externo ainda exige teste com o domínio registrado no provedor.

## Comportamentos atuais e limitações

- JWT e token de métricas são enviados por cabeçalho, nunca por query string. Downloads de backup e relatório usam requisições autenticadas. API comercial aceita POST com `key` no corpo ou `X-API-Key`; GET retorna 405.
- Roleta, sequência diária e missões compartilham teto acumulado de bônus de 10% dos depósitos confirmados. Resgates são transacionais. Missões usam entregas elegíveis no período e descontam estornos do gasto.
- Congelamento pausa novas compras, despachos, cobranças e bônus. Leitura, logout e callbacks de pagamentos já realizados continuam disponíveis. A conciliação de checkout confirmado durante congelamento precisa de ensaio externo.
- Timeout de envio ao fornecedor deixa o pedido em `awaiting_confirmation`. Não reenvie sem confirmar se o fornecedor aceitou a primeira tentativa. Estados incertos ainda exigem conciliação operacional.
- Despachos presos por mais de dois minutos são isolados para confirmação. Quando o identificador remoto é conhecido, o polling pode consultar o estado sem reenviar a compra. A conciliação retoma estornos interrompidos e efeitos de conclusão ausentes; respostas de polling não sobrescrevem cancelamentos administrativos.
- Pedidos dripfeed novos são aceitos quando o serviço permite, com 2 a 100 lotes e intervalo de 1 a 10080 minutos. O lote seguinte espera o intervalo depois da conclusão do anterior. Quantidade por lote fora do mínimo ou do máximo do serviço continua recusada.
- Subpainéis viram solicitações `pending_provisioning`, sem cobrança e sem apontamento DNS fictício. Infraestrutura, validação de domínio e TLS reais ainda não foram implementados.
- Reposição possui janela/cooldown e consulta `refill_status`; diferenças entre contratos de fornecedores ainda precisam de homologação.
- A CSP está aplicada, porém scripts/handlers legados ainda exigem `unsafe-inline`. A migração para uma política estrita permanece pendente. Sessões ainda são mantidas em `localStorage` no frontend.
- Relatórios financeiros apresentam custos estimados; taxas reais e liquidação upstream não estão integralmente conciliadas.
- PostgreSQL e BullMQ não são suportados nesta versão. Configurações de drivers não implementados falham explicitamente.
- Não há homologação de VPS, carga sustentada, OAuth individual para todas as assinaturas, provisionamento de subpainéis, emissão fiscal nem revisão editorial/WCAG integral.

`/health/live` indica processo ativo. `/health/ready` verifica banco e atraso da fila; não comprova disponibilidade dos provedores ou do SMTP. `/metrics` exige `X-Metrics-Token`.
