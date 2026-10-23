const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'smm-tests-'));
try {
  const result = spawnSync(
    process.execPath,
    [
      '--require',
      path.join(__dirname, 'test-setup.cjs'),
      '--test',
      '--test-concurrency=1',
      ...fs
        .readdirSync(path.join(root, 'server/__tests__'))
        .filter((f) => f.endsWith('.test.js'))
        .map((f) => path.join(root, 'server/__tests__', f)),
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DB_PATH: path.join(temp, 'test.sqlite'),
        MAIL_ENABLED: 'false',
        JWT_SECRET: require('node:crypto').randomBytes(48).toString('hex'),
        SETTINGS_ENCRYPTION_KEY: /^[0-9a-f]{64}$/i.test(
          process.env.SETTINGS_ENCRYPTION_KEY || ''
        )
          ? process.env.SETTINGS_ENCRYPTION_KEY
          : require('node:crypto').randomBytes(32).toString('hex'),
      },
    }
  );
  process.exitCode = result.status ?? 1;
} finally {
  const resolved = path.resolve(temp);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolved).startsWith('smm-tests-')
  )
    throw new Error('Diretório temporário inválido');
  fs.rmSync(resolved, { recursive: true, force: true });
}
