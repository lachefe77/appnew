const test = require('node:test'),
  assert = require('node:assert/strict');
const { db } = require('../db');
const { runLeased } = require('../worker-lease');
test('Lease impede sobreposição e recupera execução após expiração', async () => {
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  let count = 0;
  const first = runLeased('test-overlap', async () => {
    count++;
    await wait;
  });
  assert.equal(
    await runLeased('test-overlap', () => {
      count++;
    }),
    false
  );
  release();
  assert.equal(await first, true);
  assert.equal(count, 1);
  db.prepare(
    'INSERT INTO worker_leases(name,owner,expires_at) VALUES(?,?,?)'
  ).run('test-expired', 'dead-process', Date.now() - 1000);
  assert.equal(
    await runLeased('test-expired', () => {
      count++;
    }),
    true
  );
  assert.equal(count, 2);
  await assert.rejects(
    runLeased('test-failure', () => {
      throw new Error('fixture');
    }),
    /fixture/
  );
  assert.equal(
    db.prepare('SELECT * FROM worker_leases WHERE name=?').get('test-failure'),
    undefined
  );
});
