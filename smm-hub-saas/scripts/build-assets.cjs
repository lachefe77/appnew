const fs = require('node:fs'),
  path = require('node:path'),
  { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'),
  vendor = path.join(root, 'public/vendor');
fs.mkdirSync(vendor, { recursive: true });
const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules/@tailwindcss/cli/dist/index.mjs'),
    '-i',
    'scripts/assets-input.css',
    '-o',
    'public/vendor/tailwind.css',
    '--minify',
  ],
  { cwd: root, stdio: 'inherit' }
);
if (result.status !== 0) process.exit(result.status || 1);
fs.copyFileSync(
  path.join(root, 'node_modules/chart.js/dist/chart.umd.js'),
  path.join(vendor, 'chart.umd.js')
);
for (const folder of ['css', 'webfonts'])
  fs.cpSync(
    path.join(root, 'node_modules/@fortawesome/fontawesome-free', folder),
    path.join(vendor, 'fontawesome', folder),
    { recursive: true }
  );
fs.copyFileSync(
  path.join(root, 'node_modules/@fortawesome/fontawesome-free/LICENSE.txt'),
  path.join(vendor, 'fontawesome/LICENSE.txt')
);
console.log('CSS, gráficos e ícones locais preparados.');
const crypto = require('node:crypto');
const hash = crypto.createHash('sha256');
for (const file of ['panel-events.js','social.js','child-panels.js','branding.js','operations.js','operations.css','operations.html','app.js','painel.js','painel.css','painel.html','index.html','entry.js','panel-session.js','brand.css','vendor/tailwind.css'])
  hash.update(fs.readFileSync(path.join(root, 'public', file)));
const sw = path.join(root, 'public/service-worker.js');
fs.writeFileSync(
  sw,
  fs
    .readFileSync(sw, 'utf8')
    .replace(
      /const CACHE_NAME = '[^']+';/,
      "const CACHE_NAME = 'smmhub-" + hash.digest('hex').slice(0, 16) + "';"
    )
);
for (const candidate of ['LICENSE.md', 'LICENSE']) {
  const file = path.join(root, 'node_modules/chart.js', candidate);
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(vendor, 'chart.LICENSE.txt'));
    break;
  }
}
