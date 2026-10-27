# Prompt melhorado — Novos Horizontes

Cole o bloco abaixo na IA que for continuar o sistema. Ele substitui o briefing original: o fluxo de dinheiro, o schema e os critérios de aceite ficaram fechados, e o que era marketing ou afirmação falsa saiu do código.

---

Você é engenheiro de software sênior. Continue o SaaS **Novos Horizontes**, já iniciado neste repositório. Não recomece do zero e não deixe função vazia no caminho que o sandbox exercita.

## Produto

Duas frentes no mesmo banco:

1. **B2C.** O consumidor compra na vitrine e paga com PIX. O pedido só vai para o fornecedor depois que o webhook marca a cobrança como paga.
2. **B2B.** O revendedor recarrega uma carteira por PIX e vende o catálogo. Na venda, o sistema trava a carteira, debita o atacado e enfileira o despacho. O preço de atacado já contém a margem da plataforma.

O fornecedor é pago com saldo pré-pago da operação (CJ `payBalance` ou saldo interno do galpão ligado ao Bling). Não há cartão da operação no fluxo.

## Stack

- TypeScript estrito, Next.js App Router, Tailwind.
- PostgreSQL e Prisma. Dinheiro em centavos inteiros (`BigInt` na carteira e no razão). Nunca `float`.
- Redis e BullMQ para despacho, lembrete de PIX e retentativa. Se o Redis cair, a tabela `OutboxJob` continua sendo a fonte da fila: o worker varre `PENDING` com `FOR UPDATE`.
- `docker-compose.yml` com Postgres e Redis. Evolution API só no profile `whatsapp`.

## Invariantes

- Crédito e débito acontecem na mesma transação que o `SELECT ... FOR UPDATE` da carteira e o insert em `WalletLedger`.
- `idempotencyKey` do razão é único. Repetir o webhook não muda o saldo.
- `WebhookEvent` é único por `(provider, externalId)`. O `externalId` é o id do **evento**. A cobrança é idempotente pelo id do pagamento (`PixCharge.externalId`), porque o Asaas pode mandar `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED`.
- Saldo da carteira nunca fica negativo. Há `CHECK` no Postgres e checagem antes do update.
- Estoque é reservado na criação do pedido e devolvido se o PIX expira ou se o admin estorna.
- Pedido B2B sem saldo não é criado.
- Job de despacho é idempotente: se já existe `supplierOrderId`, a retentativa só paga; não cria outro pedido no fornecedor.
- Falta de saldo mestre marca o pedido como `FAILED`, pausa a fila e grava alerta. Não fica tentando até zerar a conta.
- Sandbox não sobe com `NODE_ENV=production`.

## Schema que já existe e deve ser preservado

`User`, `Wallet`, `WalletLedger`, `Product`, `CatalogImport`, `Order`, `OrderItem`, `PixCharge`, `WebhookEvent`, `OutboxJob`, `AdminAlert`, `NotificationLog`, `Setting`.

Papéis: `ADMIN | RESELLER | CUSTOMER`. Status de pagamento inclui `REFUNDED`, além de `PENDING | PAID | EXPIRED`.

Preço de catálogo, quando vier da sincronização:

- atacado = `round(custo * PLATFORM_SPREAD)` com spread padrão 1,35
- varejo = `round(custo * RETAIL_MULTIPLIER)` com padrão 2,5
- estoque menor que 5 pausa o produto

Custo da CJ vem em dólar. Converta com `USD_BRL_RATE` e deixe explícito que a cotação é manual. O `getBalance` da CJ também é dólar; o limite desse saldo é `CJ_LOW_BALANCE_THRESHOLD_CENTS`. O saldo Bling/galpão é em reais.

## Módulos

### Carteira e PIX

- `generatePixDeposit`: recarga mínima R$ 150, cobrança no provedor (`sandbox`, Asaas ou OpenPix) e `PixCharge` pendente. Não credita antes do webhook.
- `POST /api/webhooks/payment`: valida HMAC (sandbox e OpenPix) ou o header `asaas-access-token` (Asaas), trava o evento e a cobrança, credita a carteira ou marca o pedido B2C como pago e cria o job de despacho.
- `debitForOrder`: trava a carteira, recusa saldo insuficiente, grava débito negativo no razão.

### Fornecedores

Interface `createOrder` + `payOrder` + `syncCatalog` + `getMasterBalance`.

- **CJ:** token em cache, `createOrderV2` com `payType: 3` e `taxId` (CPF), depois `POST /shopping/pay/payBalance`. Logística obrigatória em `CJ_LOGISTIC_NAME`. Origem padrão `BR`.
- **Bling:** OAuth2 com refresh token gravado em `Setting` (o Bling gira o token). Cria contato e `POST /pedidos/vendas` com endereço. O pagamento do galpão é o saldo interno, porque a API de venda não debita uma carteira pré-paga.
- **Sandbox:** mesmo contrato, sem HTTP. Paga debitando `Setting`.

Fila `fulfillment-queue`: 5 tentativas, backoff exponencial.

### Rastreio e lembrete

- `POST /api/webhooks/supplier-tracking` grava o código, muda para `SHIPPED` ou `DELIVERED` e registra WhatsApp.
- Cobrança `WAITING_PAYMENT` ganha job em `abandoned-pix-queue` com atraso de 7 minutos em produção.
- O texto padrão diz o valor, o código do pedido e o PIX, e avisa que a pessoa pode ignorar se já pagou ou desistiu. Não escreva que o caminhão sai às 16h nem que o lote está separado, a menos que isso seja verdade e venha de configuração. Áudio da Evolution só se `RECOVERY_AUDIO_URL` existir. `ptt` fica desligado por padrão.
- Sem Evolution, grave a mensagem em `NotificationLog` com status `SKIPPED`. O admin lê em `/admin/mensagens`.

### Watchdog

A cada 10 minutos, leia o saldo mestre. Abaixo do limite, um alerta (Telegram se houver token, sempre na tabela). Não repita o mesmo alerta a cada ciclo. Ao repor, avise uma vez.

## Interface que já existe

- Vitrine, produto com checkout PIX, página do pedido com QR e simulação só no sandbox.
- `/revenda`, cadastro, login.
- Painel: saldo, modal de recarga, catálogo com importar em um clique, pedidos do revendedor.
- Admin: liquidez, pausa da fila, sincronização, rastreio simulado, estorno, mensagens.

Mantenha o português do Brasil na interface. Não prometa envio em 24 horas como fato automático.

## Fora deste sistema

Anúncio, roteiro de vídeo e meta de postagem não entram no código. Não baixe vídeo de Douyin, AliExpress ou catálogo de terceiro para publicar. Curadoria de produto é manual: o sync traz custo e estoque, o preço de vitrine pode ser ajustado depois.

## Pronto quando

- `npm run typecheck` passa.
- `npm run smoke` mostra um único débito vencedor entre oito concorrentes e um único crédito para dois webhooks da mesma cobrança.
- No browser: gerar PIX, simular pagamento, ver despacho; entrar como revenda, importar, vender e ver o extrato; no admin, ver alerta de saldo baixo e a mensagem de lembrete.
