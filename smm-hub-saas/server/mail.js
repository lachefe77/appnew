const nodemailer = require('nodemailer');
const config = require('./config');
const logger = require('./logger');

let transporter = null;

function getTransporter() {
  if (!config.smtp.enabled || !config.smtp.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user
        ? { user: config.smtp.user, pass: config.smtp.pass }
        : undefined,
    });
  }
  return transporter;
}

const TEMPLATES = {
  ticket_reply: ({ name, ticketId }) => ({
    subject: 'Resposta ao chamado #' + ticketId,
    html: wrap(
      `<h1>Olá, ${esc(name)}</h1><p>A equipe respondeu ao chamado #${Number(ticketId)}.</p><p><a href="${esc(config.publicUrl)}/tickets.html">Consultar resposta no painel</a></p>`
    ),
  }),
  welcome: ({ name }) => ({
    subject: '🎉 Bem-vindo ao SMM Hub!',
    html: wrap(`<h1>Olá, ${esc(name)}!</h1>
      <p>Sua conta foi criada com sucesso. Consulte no painel os serviços, preços e condições disponíveis.</p>
      <p><a href="${esc(config.publicUrl)}/vitrine.html" style="${btn}">Explorar serviços</a></p>`),
  }),
  password_reset: ({ name, token, baseUrl }) => ({
    subject: '🔐 Redefinição de senha SMM Hub',
    html: wrap(`<h1>Olá, ${esc(name)}</h1>
      <p>Recebemos um pedido de redefinição de senha. Clique abaixo (válido por 1 hora):</p>
      <p><a href="${esc(baseUrl)}/reset.html?token=${encodeURIComponent(token)}" style="${btn}">Redefinir senha</a></p>
      <p style="color:#64748b;font-size:12px">Se você não solicitou, ignore este e-mail.</p>`),
  }),
  order_failed: ({ name, orderId, serviceName }) => ({
    subject: `Pedido #${orderId} não foi concluído`,
    html: wrap(`<h1>Pedido não concluído</h1>
      <p>Olá ${esc(name)}, o pedido <strong>#${orderId}</strong> (${esc(serviceName)}) falhou. O valor volta para o saldo.</p>
      <p>A ficha do pedido no painel mostra o que aconteceu.</p>`),
  }),
  order_completed: ({ name, orderId, serviceName, quantity, link }) => ({
    subject: `✅ Pedido #${orderId} concluído!`,
    html: wrap(`<h1>Entrega finalizada!</h1>
      <p>Olá ${esc(name)}, seu pedido <strong>#${orderId}</strong> foi concluído com sucesso.</p>
      <ul>
        <li><strong>Serviço:</strong> ${esc(serviceName)}</li>
        <li><strong>Quantidade:</strong> ${quantity.toLocaleString('pt-BR')}</li>
        <li><strong>Link:</strong> ${esc(link)}</li>
      </ul>
      <p>Acompanhe o histórico e avalie sua experiência no painel.</p>`),
  }),
  low_balance: ({ name, balance }) => ({
    subject: '⚠️ Saldo baixo na sua carteira SMM Hub',
    html: wrap(`<h1>Olá, ${esc(name)}</h1>
      <p>Seu saldo caiu para <strong>R$ ${(balance / 100).toFixed(2).replace('.', ',')}</strong>.</p>
      <p>Recarregue via Pix instantâneo para não interromper suas campanhas.</p>`),
  }),
  deposit_approved: ({ name, amount, newBalance }) => ({
    subject: '💰 Depósito aprovado!',
    html: wrap(`<h1>Pagamento confirmado</h1>
      <p>Olá ${esc(name)}, seu depósito de <strong>R$ ${(amount / 100).toFixed(2).replace('.', ',')}</strong> foi creditado.</p>
      <p>Novo saldo disponível: <strong>R$ ${(newBalance / 100).toFixed(2).replace('.', ',')}</strong></p>`),
  }),
};

const btn =
  'display:inline-block;padding:12px 24px;background:#0d9488;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold';

function wrap(inner) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
    <body style="font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;margin:0;padding:40px">
    <div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 4px 12px rgba(0,0,0,0.06)">
    <div style="font-size:22px;font-weight:900;background:linear-gradient(135deg,#0d9488,#10b981);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:24px">⚡ SMM HUB BRASIL</div>
    ${inner}
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0">
    <p style="color:#94a3b8;font-size:12px">Enviado automaticamente. Não responda este e-mail.</p>
    </div></body></html>`;
}
function esc(s) {
  return String(s || '').replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]
  );
}

async function sendMailNow(to, templateName, data) {
  const t = getTransporter();
  if (!t) {
    logger.debug(
      { to, template: templateName },
      'E-mail skipped (SMTP desativado)'
    );
    return { skipped: true };
  }
  const tpl = TEMPLATES[templateName];
  if (!tpl) throw new Error(`Template ${templateName} não existe.`);
  const built = tpl(data);
  try {
    const info = await t.sendMail({
      from: config.smtp.from,
      to,
      subject: built.subject,
      html: built.html,
    });
    logger.info(
      { to, template: templateName, messageId: info.messageId },
      'E-mail enviado'
    );
    return { success: true, messageId: info.messageId };
  } catch (err) {
    logger.error(
      { err: err.message, to, template: templateName },
      'Falha no envio de e-mail'
    );
    throw new Error('Falha de entrega SMTP.');
  }
}

function sendMail(to, templateName, data) {
  if (!getTransporter()) return Promise.resolve({ skipped: true });
  const queue = require('./job-queue');
  const userId = require('./db')
    .db.prepare('SELECT id FROM users WHERE email=?')
    .get(to)?.id;
  const encrypted = require('./runtime-config').encrypt(
    JSON.stringify({ to, templateName, data, userId })
  );
  const id = queue.enqueue('mail', { encrypted }, { userId });
  return Promise.resolve({ queued: true, id });
}
TEMPLATES.verify_email = ({ name, token, baseUrl }) => ({
  subject: 'Confirme seu e-mail SMM Hub',
  html: wrap(
    `<h1>Olá, ${esc(name)}</h1><p><a href="${esc(baseUrl)}/verify-email.html?token=${encodeURIComponent(token)}">Confirmar e-mail</a></p><p>Este link expira em uma hora.</p>`
  ),
});
function registerMailWorker() {
  require('./job-queue').registerHandler('mail', async ({ encrypted }) => {
    const { to, templateName, data, userId } = JSON.parse(
      require('./runtime-config').decrypt(encrypted)
    );
    if (
      userId &&
      !require('./db')
        .db.prepare(
          "SELECT id FROM users WHERE id=? AND status='active' AND deleted_at IS NULL"
        )
        .get(userId)
    )
      return;
    const result = await sendMailNow(to, templateName, data);
    if (result.skipped) throw new Error('SMTP indisponível.');
  });
}
async function verifyTransport(){const transport=getTransporter();if(!transport)throw Object.assign(new Error('SMTP desativado. Configure o servidor antes de testar.'),{status:503});await transport.verify();return{verified:true};}
module.exports = { sendMail, TEMPLATES, registerMailWorker, verifyTransport };
