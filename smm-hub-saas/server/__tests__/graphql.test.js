const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('../graphql');

test('GraphQL respeita seleção, aliases, variáveis e rejeita campos privados', () => {
  const result = resolve(
    'query Catalog($n: Int!) { catalog: services(limit: $n) { id name } }',
    {},
    { n: 1 }
  );
  assert.equal(result.errors, undefined);
  assert.equal(result.data.catalog.length, 1);
  assert.deepEqual(Object.keys(result.data.catalog[0]), ['id', 'name']);
  assert.ok(resolve('{ services { provider_id } }').errors);
  assert.ok(resolve('{ services(limit: 1000000) { id } }').errors);
  assert.ok(resolve('{ me { email } }').errors);
  assert.ok(resolve('{ myOrders { id } }').errors);
  assert.ok(resolve('mutation { services { id } }').errors);
  assert.ok(
    resolve('{ services { ...F } } fragment F on Service { id }').errors
  );
  assert.ok(resolve('{').errors);
});

test('GraphQL limita aliases para evitar multiplicação de consultas', () => {
  const query =
    '{' +
    Array.from({ length: 60 }, (_, i) => `a${i}: services { id }`).join(' ') +
    '}';
  assert.ok(resolve(query).errors);
});
