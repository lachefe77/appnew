const dns = require('node:dns/promises');
const https = require('node:https');
const net = require('node:net');
const blocked = new net.BlockList();
for (const [ip, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
])
  blocked.addSubnet(ip, bits, 'ipv4');
for (const [ip, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
])
  blocked.addSubnet(ip, bits, 'ipv6');
function isPublicAddress(address) {
  if (/^::ffff:/i.test(address)) return false;
  const family = net.isIP(address);
  if (!family) return false;
  if (family === 6 && !/^[23][0-9a-f]{3}:/i.test(address)) return false;
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}
async function resolveWebhook(raw, lookup = dns.lookup) {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  )
    throw new Error('Webhook requer HTTPS na porta 443, sem credenciais.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const records = net.isIP(host)
    ? [{ address: host, family: net.isIP(host) }]
    : await lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some((r) => !isPublicAddress(r.address)))
    throw new Error('Destino do webhook deve estar na Internet pública.');
  return { url, record: records[0] };
}
async function postWebhook(raw, body, headers) {
  const { url, record } = await resolveWebhook(raw);
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        lookup: (_host, options, cb) =>
          options?.all
            ? cb(null, [record])
            : cb(null, record.address, record.family),
        timeout: 8000,
      },
      (res) => {
        let bytes = 0;
        res.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > 65536) res.destroy(new Error('Resposta excedeu limite.'));
        });
        res.on('error', reject);
        res.on('end', () =>
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
          })
        );
      }
    );
    req.on('timeout', () => req.destroy(new Error('Timeout do webhook.')));
    req.on('error', reject);
    req.end(body);
  });
}
module.exports = { isPublicAddress, resolveWebhook, postWebhook };
