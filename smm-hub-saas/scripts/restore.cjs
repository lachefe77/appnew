const fs = require('node:fs'),
  path = require('node:path');
const [source] = process.argv.slice(2);
const target = process.env.DB_PATH;
if (!source || !target)
  throw new Error(
    'Defina DB_PATH e informe o arquivo de backup; mantenha a aplicação parada.'
  );
const input = path.resolve(source),
  output = path.resolve(target);
if (input === output) throw new Error('Origem e destino devem ser diferentes.');
const { DatabaseSync } = require('node:sqlite');
const check = new DatabaseSync(input, { readOnly: true });
if (check.prepare('PRAGMA quick_check').get().quick_check !== 'ok')
  throw new Error('Backup inválido.');
check.close();
for (const suffix of ['-wal', '-shm'])
  if (fs.existsSync(output + suffix) && fs.statSync(output + suffix).size > 0)
    throw new Error(
      'Banco contém WAL/SHM. Pare a aplicação, faça backup consistente e resolva o journal antes da restauração.'
    );
fs.mkdirSync(path.dirname(output), { recursive: true });
if (fs.existsSync(output))
  fs.copyFileSync(output, output + '.before-restore-' + Date.now());
const staged = output + '.restoring';
fs.copyFileSync(input, staged);
fs.renameSync(staged, output);
console.log(
  'Banco restaurado. Inicie uma imagem compatível com o schema deste backup.'
);
