const test = require('node:test'),
  assert = require('node:assert/strict');
test('Nodemailer gera mensagem com template escapado sem depender de SMTP externo', async () => {
  const { TEMPLATES } = require('../mail');
  const built = TEMPLATES.password_reset({
    name: '<img src=x onerror=alert(1)>',
    token: 'fixture-token',
    baseUrl: 'https://example.com',
  });
  assert.ok(!built.html.includes('<img src=x'));
  assert.ok(built.html.includes('&lt;img'));
  const transport = require('nodemailer').createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'unix',
  });
  const sent = await transport.sendMail({
    from: 'panel@example.com',
    to: 'fixture@example.com',
    subject: built.subject,
    html: built.html,
  });
  assert.ok(Buffer.isBuffer(sent.message));
  assert.match(sent.message.toString(), /MIME-Version: 1.0/);
  transport.close();
});
