const test = require('node:test'),
  assert = require('node:assert/strict');
const { canonical, atLeast } = require('../decimal-amount');
test('Conciliação decimal preserva unidades sem tolerância de ponto flutuante', () => {
  assert.equal(canonical(1e-8), '0.00000001');
  assert.equal(canonical('1.230000'), '1.23');
  assert.equal(atLeast('0.123456789012345677', '0.123456789012345678'), false);
  assert.equal(atLeast('0.123456789012345678', '0.123456789012345678'), true);
  for (const value of ['NaN', 'Infinity', '-1', {}, '0.0000000000000000001'])
    assert.equal(atLeast(value, '1'), false);
  assert.throws(() => canonical('0'));
});
