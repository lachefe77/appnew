const https = require('node:https');
const { resolveWebhook } = require('./webhook-http');
function sealKey(key) {
  return require('./factor-secret').seal(key);
}
async function providerFetch(raw, options) {
  const { url, record } = await resolveWebhook(raw);
  const form = new URLSearchParams(options.body);
  form.set('key', require('./factor-secret').open(form.get('key')));
  const body = form.toString();
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'SMMHub-Platform/2.1',
          'Content-Length': Buffer.byteLength(body),
        },
        signal: options.signal,
        timeout: 15000,
        lookup: (_host, settings, cb) =>
          settings?.all
            ? cb(null, [record])
            : cb(null, record.address, record.family),
      },
      (response) => {
        let bytes = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) {
            response.destroy(new Error('Resposta do provedor excedeu limite.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300)
            return reject(
              new Error(
                'Resposta HTTP inválida do provedor: ' + response.statusCode
              )
            );
          resolve({
            ok: true,
            status: response.statusCode,
            json: async () =>
              JSON.parse(Buffer.concat(chunks).toString('utf8')),
          });
        });
      }
    );
    request.on('timeout', () =>
      request.destroy(new Error('Timeout do provedor.'))
    );
    request.on('error', reject);
    request.end(body);
  });
}
module.exports = { providerFetch, sealKey };
