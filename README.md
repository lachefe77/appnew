# Novos Horizontes

Base local de um SaaS de atacado unitário: vitrine B2C, carteira pré-paga do revendedor, PIX, ledger com trava no Postgres e despacho em fila. Sem chave de Asaas, CJ, Bling, WhatsApp ou Telegram, tudo roda em **sandbox** e dá para clicar o fluxo inteiro.

O arquivo `docs/prompt-melhorado.md` é o briefing reescrito. Ele corrige o prompt original: dinheiro em centavos, cobrança separada do pedido, idempotência de verdade, saldo da CJ em dólar e lembrete de PIX sem urgência inventada.

## Subir no localhost

Com Docker:

```bash
cp .env.example .env
docker compose up -d
npm install
npx prisma db push
npm run db:seed
npm run dev
npm run worker
```

Abra http://localhost:3000.

A Evolution API fica fora do `docker compose up` padrão. Para tentar o container: `docker compose --profile whatsapp up -d`. Sem ela, as mensagens aparecem em `/admin/mensagens`.

## Contas de demonstração

| Papel | E-mail | Senha |
| --- | --- | --- |
| Revenda | revenda@novoshorizontes.test | Revenda#Horizonte |
| Admin | admin@novoshorizontes.test | Admin#Horizonte |

O seed cria o pedido `NH-DEMO001` com PIX pendente por 30 minutos. A vitrine só mostra o atalho enquanto ele ainda está `PENDING`. Depois disso o pedido expira e o link some.

## O que exercitar

1. Na vitrine, abra um produto, preencha o checkout e gere o PIX.
2. Em `/pedido/...`, use **Simular pagamento**. O pedido vai para a fila e, com `INLINE_JOBS=true`, o sandbox despacha na hora.
3. Entre como revenda. O saldo já cobre um pedido. Importe um item e lance a venda: o atacado sai da carteira.
4. Recarregue R$ 150 ou mais e simule o PIX. O mesmo webhook duas vezes não soma o saldo duas vezes.
5. No admin, dispare os lembretes, rode o watchdog, baixe o saldo CJ e veja o alerta. Reponha o saldo antes de despachar de novo.
6. `npm run smoke` trava a carteira com oito débitos paralelos e exige que só um vença.

## Produção

Troque `PAYMENT_PROVIDER`, `SUPPLIER_MODE` e os segredos. `NODE_ENV=production` recusa sandbox. O atraso do lembrete de PIX em produção é 7 minutos (`ABANDONED_PIX_DELAY_MS=420000`). O `.env` local usa 15 segundos para o teste.

O saldo da CJ na API é em **dólar**. O watchdog usa `CJ_LOW_BALANCE_THRESHOLD_CENTS` nesse caso. O saldo do galpão nacional (Bling) é um controle interno em reais: o Bling recebe o pedido de venda, e o pré-pago do galpão é o número que você repõe.
