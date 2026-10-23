const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(path.join(root, 'tests-e2e')).filter(name => name.endsWith('.spec.js'));
// Fresh temporary databases and limiter windows for the security group.
// Keep production rate limits in force during browser tests.
const security = files.filter(name => name === 'security.spec.js');
const flows = files.filter(name => name !== 'security.spec.js');
for (const group of [...flows.map(name=>[name]), security]) {
  if (!group.length) continue;
  const run = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...group.map(name => 'tests-e2e/' + name)], { cwd: root, stdio: 'inherit' });
  if (run.status !== 0) process.exit(run.status || 1);
}
