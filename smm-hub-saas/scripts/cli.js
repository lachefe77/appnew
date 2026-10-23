#!/usr/bin/env node
/* 46. CLI admin — uso: node scripts/cli.js <command> [args...] */
const { db, creditBalanceAtomic, debitBalanceAtomic } = require('../server/db');
const { initDB } = require('../server/db');
const { applyExtendedSchema } = require('../server/extended-schema');
const { applyV3Schema } = require('../server/extended-schema-v3');

initDB();
applyExtendedSchema();
applyV3Schema();

const [cmd, ...args] = process.argv.slice(2);

const commands = {
  'adjust-balance': ([uid, amount]) => {
    const cents = Math.round(parseFloat(amount) * 100);
    if (cents > 0)
      console.log('Novo saldo:', creditBalanceAtomic(parseInt(uid), cents));
    else console.log('Novo saldo:', debitBalanceAtomic(parseInt(uid), -cents));
  },
  'list-users': () => {
    console.table(
      db
        .prepare(
          'SELECT id, name, email, balance_cents, role, status FROM users ORDER BY id ASC'
        )
        .all()
    );
  },
  suspend: ([uid]) => {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(
      'suspended',
      uid
    );
    console.log('Usuário', uid, 'suspenso.');
  },
  activate: ([uid]) => {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run('active', uid);
    console.log('Usuário', uid, 'ativo.');
  },
  'reset-password': ([uid, newPass]) => {
    const { hashPassword } = require('../server/db');
    const { hash, salt } = hashPassword(newPass);
    db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(
      hash,
      salt,
      uid
    );
    console.log('Senha resetada para user', uid);
  },
  stats: () => {
    console.log(
      'Users:',
      db.prepare('SELECT COUNT(*) as c FROM users').get().c
    );
    console.log(
      'Orders:',
      db.prepare('SELECT COUNT(*) as c FROM orders').get().c
    );
    console.log(
      'Services:',
      db.prepare('SELECT COUNT(*) as c FROM services').get().c
    );
    console.log(
      'Pix pagos:',
      db
        .prepare("SELECT COUNT(*) as c FROM pix_invoices WHERE status='paid'")
        .get().c
    );
  },
  help: () => {
    console.log(`Comandos:
  adjust-balance <uid> <brl>    — soma/subtrai saldo
  list-users                    — lista todos usuários
  suspend <uid>                 — suspende conta
  activate <uid>                — reativa conta
  reset-password <uid> <senha>  — reseta senha
  stats                         — totais da base`);
  },
};

if (!cmd || !commands[cmd]) commands.help();
else commands[cmd](args);
process.exit(0);
