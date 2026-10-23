const test = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto'),
  express = require('express');
const { db, hashPassword } = require('../db');
const { signToken } = require('../auth');
test('Chamados preservam isolamento, anexos válidos e acesso da equipe', async () => {
  const fixture = (role) => {
    const h = hashPassword('Support-test-12345');
    const id = db
      .prepare(
        "INSERT INTO users(uuid,name,email,password_hash,salt,api_key,role) VALUES(?,'Support',?,?,?,?,?)"
      )
      .run(
        crypto.randomUUID(),
        crypto.randomUUID() + '@test.invalid',
        h.hash,
        h.salt,
        crypto.randomUUID(),
        role
      ).lastInsertRowid;
    return signToken(db.prepare('SELECT * FROM users WHERE id=?').get(id));
  };
  const owner = fixture('user'),
    other = fixture('user'),
    staff = fixture('support');
  const app = express();
  app.use(express.json());
  app.use('/api/tickets', require('../routes/tickets'));
  app.use('/api/support', require('../routes/support'));
  app.use('/api/admin', require('../auth').requireAdmin, (req, res) =>
    res.json({ ok: true })
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const request = async (route, token, body) =>
    fetch('http://127.0.0.1:' + server.address().port + route, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    const attachment = {
      filename: 'document.pdf',
      mime_type: 'application/pdf',
      data_base64: Buffer.from('%PDF-1.4\nfixture').toString('base64'),
    };
    const created = await request('/api/tickets', owner, {
      subject: 'Fixture',
      message: 'Mensagem',
      attachments: [attachment],
    });
    assert.equal(created.status, 201);
    const id = (await created.json()).ticket_id;
    assert.equal((await request('/api/tickets/' + id, other)).status, 404);
    const opened = await request('/api/support/tickets/' + id, staff);
    assert.equal(opened.status, 200);
    const att = (await opened.json()).messages[0].attachments[0];
    assert.equal(
      (await request('/api/tickets/attachment/' + att.id, other)).status,
      404
    );
    const download = await request('/api/tickets/attachment/' + att.id, staff);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition'), /^attachment/);
    assert.equal(await download.text(), '%PDF-1.4\nfixture');
    assert.equal(
      (
        await request('/api/support/tickets/' + id + '/reply', staff, {
          message: 'Resposta',
          close: true,
        })
      ).status,
      200
    );
    assert.equal((await request('/api/admin', staff)).status, 403);
    const before = db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n;
    assert.equal(
      (
        await request('/api/tickets', owner, {
          subject: 'Invalid',
          message: 'Mensagem',
          attachments: [
            {
              ...attachment,
              data_base64: Buffer.from('<script>').toString('base64'),
            },
          ],
        })
      ).status,
      400
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n,
      before,
      'Anexo inválido reverte o chamado'
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
