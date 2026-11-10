# Fut Surebet

Base dos dias 1 e 2: conta, sessão, painel de sinais fechado sem plano e administração da casa.

A interface está em português. O visual é uma casa de apostas escura, com verde de alto contraste e navegação direta. Não há odds ao vivo, pagamento nem cálculo de surebet nesta versão.

## O que já funciona

- Cadastro, entrada e sessão.
- Sem plano ativo, a pessoa entra e encontra o painel fechado.
- Com plano ativo, o painel abre numa grade vazia. Filtros ficam desligados.
- Plano congelado, removido, vencido ou conta suspensa fecha o painel de novo.
- Administração com menu vertical: usuários, planos, pedidos, cupons, afiliados, avisos, auditoria, status do site e textos.
- Pagamentos e suporte existem no menu e ainda não recebem dados.
- Textos, preços e o que o público vê saem do banco. A administração altera sem editar arquivo.

O modelo cobre usuário, plano, pedido, casa, evento, sinal, banca, cupom, afiliado, aviso e auditoria. Casa, evento e sinal estão no banco para a grade futura. Esta versão não grava odd.

## Conta de administração

Criada pelo seed, só se o e-mail ainda não existir:

- E-mail: `admin@futsurebet.com`
- Senha: `FutAdmin#2026`

No `.env`, a senha precisa de aspas porque o `#` começa um comentário.

Troque a senha antes de qualquer uso fora da sua máquina. O seed não regrava a senha se a conta já existe.

## Como rodar

Postgres 16. O `docker-compose.yml` sobe um banco com usuário, senha e base `futsurebet`.

```bash
cp .env.example .env
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Abra `http://localhost:3000`.

Os testes usam o banco `futsurebet_test` na mesma instância:

```bash
npm test
```

## Fora deste recorte

Pix, cripto, coleta de odds, motor de surebet, stake, alerta e a fila de suporte.
