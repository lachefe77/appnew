const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs'),
  path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = process.env.CAPACITY_PORT || '4187';
const base = 'http://127.0.0.1:' + port;
const child = spawn(
  process.execPath,
  [path.join(__dirname, 'e2e-server.cjs')],
  {
    cwd: root,
    env: { ...process.env, E2E_PORT: port },
    stdio: 'ignore',
    windowsHide: true,
  }
);
async function request(route, token, body) {
  const response = await fetch(base + route, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, data: await response.json() };
}
async function main() {
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null)
        throw new Error('Servidor de teste encerrou.');
      try {
        ready = (await request('/health')).status === 200;
      } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('Servidor não ficou pronto.');
    const login = await request('/api/auth/login', null, {
      email: 'admin@e2e.invalid',
      password: 'E2E-password-12345',
    });
    if (login.status !== 200) throw new Error('Login de fixture falhou.');
    const token = login.data.token;
    const service = (await request('/api/services')).data.services[0];
    const operations = Array.from({ length: 80 }, (_, i) =>
      i % 5 === 0
        ? {
            route: '/api/orders',
            body: {
              service_id: service.id,
              quantity: service.min_quantity,
              link: 'https://example.com/capacity/' + i,
            },
            expected: 201,
          }
        : {
            route: i % 2 ? '/api/services' : '/api/orders?limit=25',
            expected: 200,
          }
    );
    const times = [],
      failures = [];
    let cursor = 0;
    const started = performance.now();
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (cursor < operations.length) {
          const operation = operations[cursor++],
            start = performance.now();
          try {
            const response = await request(
              operation.route,
              token,
              operation.body
            );
            if (response.status !== operation.expected)
              failures.push({
                route: operation.route,
                status: response.status,
              });
          } catch (error) {
            failures.push({ route: operation.route, error: error.message });
          }
          times.push(performance.now() - start);
        }
      })
    );
    const elapsed = performance.now() - started;
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1];
    const result = {
      date: new Date().toISOString(),
      environment:
        'Windows local; Node ' +
        process.version +
        '; SQLite temporário; provedores mock; oito conexões concorrentes',
      requests: 80,
      read_requests: 64,
      write_requests: 16,
      concurrency: 8,
      elapsed_ms: Math.round(elapsed),
      requests_per_second: Number((80000 / elapsed).toFixed(2)),
      p50_ms: Number(times[39].toFixed(2)),
      p95_ms: Number(p95.toFixed(2)),
      max_ms: Number(times.at(-1).toFixed(2)),
      failures,
      criteria: { zero_errors: true, p95_below_ms: 1000 },
      passed: failures.length === 0 && p95 < 1000,
      limitations:
        'Amostra curta; não determina capacidade da VPS, duração longa, rede externa ou capacidade dos provedores.',
    };
    if (process.argv[2])
      fs.writeFileSync(
        path.resolve(process.argv[2]),
        JSON.stringify(result, null, 2)
      );
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
