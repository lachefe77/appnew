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

## Operador de teste

O seed também cria, se ainda não existir:

- E-mail: `operador@futsurebet.com`
- Senha: `Operador#2026`

Essa conta já tem plano mensal e banca de R$ 1.000,00. O stake automático começa em 10% da banca.

## Grade e odds

As onze casas estão cadastradas com marca própria, não o logo oficial, e moeda de cálculo. Pinnacle.com lê a fonte pública. Ps3838 espera usuário e senha da API. Bcgame permanece em odd de teste porque a fonte pública respondeu bloqueada. As outras oito casas seguem em odd de teste. A linha ao vivo de teste de Real Madrid x Barcelona se move sozinha.

Há uma surebet de 2,50% (Flamengo x Palmeiras, odds 2,05 e 2,05) e outra de 8,00% (Lakers x Celtics, odds 2,16 e 2,16). A de 8% passa de 7% e fica destacada.

O alerta usa um canal só, escolhido na configuração: Discord, Telegram ou WhatsApp. Sem um destino real, o envio fica registrado como sem destino. O som toca no navegador quando nasce um sinal acima do piso.

## Fora deste recorte

Pix, cripto e checkout. A forma de pagamento fica para uma decisão posterior.
