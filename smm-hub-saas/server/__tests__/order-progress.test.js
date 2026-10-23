const test = require('node:test'),
  assert = require('node:assert/strict');
const { progress } = require('../order-progress');
test('Progresso pendente não aparece como entrega concluída', () => {
  assert.deepEqual(progress({ status: 'pending', quantity: 100, remains: 0 }), {
    remains: 100,
    delivered: 0,
    percent: 0,
  });
  assert.equal(
    progress({ status: 'awaiting_confirmation', quantity: 100, remains: null })
      .percent,
    0
  );
  assert.equal(
    progress({ status: 'in_progress', quantity: 100, remains: 40 }).percent,
    60
  );
  assert.equal(
    progress({ status: 'completed', quantity: 100, remains: 100 }).percent,
    100
  );
});
