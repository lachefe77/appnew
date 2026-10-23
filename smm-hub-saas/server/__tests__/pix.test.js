const test = require('node:test');
const assert = require('node:assert');
const { generatePixBRCode } = require('../pix');

test('BRCode EMV termina com CRC16 de 4 hex', () => {
  const code = generatePixBRCode({
    pixKey: 'test@smmhub.com', merchantName: 'TEST', merchantCity: 'SP',
    txid: 'TXID123', amountBRL: '10.00'
  });
  assert.ok(code.length > 60);
  const crc = code.slice(-4);
  assert.match(crc, /^[0-9A-F]{4}$/);
});

test('BRCode é idempotente para mesmos parâmetros', () => {
  const a = generatePixBRCode({ pixKey: 'a@b.c', merchantName: 'X', merchantCity: 'SP', txid: 'T1', amountBRL: '5.00' });
  const b = generatePixBRCode({ pixKey: 'a@b.c', merchantName: 'X', merchantCity: 'SP', txid: 'T1', amountBRL: '5.00' });
  assert.strictEqual(a, b);
});
