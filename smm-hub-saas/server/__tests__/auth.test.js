const test = require('node:test');
const assert = require('node:assert');
const { hashPassword, verifyPassword, calculateTier } = require('../db');

test('hashPassword produz hash determinístico com mesmo salt', () => {
  const { hash, salt } = hashPassword('senha123');
  const check = hashPassword('senha123', salt);
  assert.strictEqual(check.hash, hash);
});

test('verifyPassword valida corretamente', () => {
  const { hash, salt } = hashPassword('abc456');
  assert.ok(verifyPassword('abc456', hash, salt));
  assert.ok(!verifyPassword('errada', hash, salt));
});

test('calculateTier retorna tier correto por total depositado', () => {
  assert.strictEqual(calculateTier(0).name, 'Standard');
  assert.strictEqual(calculateTier(20000).name, 'Bronze');
  assert.strictEqual(calculateTier(50000).name, 'Silver');
  assert.strictEqual(calculateTier(150000).name, 'Gold');
  assert.strictEqual(calculateTier(500000).name, 'VIP');
});
