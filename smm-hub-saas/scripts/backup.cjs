const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { db } = require('../server/db');
const directory = path.resolve(
  process.env.BACKUP_DIR || path.join(__dirname, '../backups')
);
fs.mkdirSync(directory, { recursive: true });
const target = path.join(
  directory,
  'data-' +
    new Date().toISOString().replace(/[:.]/g, '-') +
    '-' +
    crypto.randomBytes(3).toString('hex') +
    '.sqlite'
);
db.exec("VACUUM INTO '" + target.replace(/'/g, "''") + "'");
const { DatabaseSync } = require('node:sqlite');
const copy = new DatabaseSync(target, { readOnly: true });
const result = copy.prepare('PRAGMA quick_check').get();
copy.close();
db.close();
if (result.quick_check !== 'ok')
  throw new Error('Verificação do backup falhou.');
console.log(target);
