const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'),
  file = path.join(root, '.env');
if (fs.existsSync(file))
  throw new Error(
    '.env já existe; preserve a chave de criptografia e ajuste o arquivo existente.'
  );
const secret = () => crypto.randomBytes(32).toString('hex');
const env = `NODE_ENV=production\nPORT=3000\nJWT_SECRET=${secret()}\nSETTINGS_ENCRYPTION_KEY=${secret()}\nMETRICS_TOKEN=${secret()}\nDB_DRIVER=sqlite\nDB_PATH=/app/data/data.sqlite\nQUEUE_DRIVER=sqlite\nPIX_PROVIDER=disabled\nCRYPTO_PROVIDER=disabled\nCORS_ORIGINS=https://seu-dominio.example\nAPP_PUBLIC_URL=https://seu-dominio.example\nADMIN_EMAIL=admin@seu-dominio.example\nADMIN_PASSWORD=${secret()}\nMAIL_ENABLED=false\nTRUST_PROXY=loopback\n`;
fs.writeFileSync(file, env, { mode: 0o600, flag: 'wx' });
console.log(
  '.env criado. Ajuste domínio e e-mail antes de iniciar; a senha inicial está nesse arquivo. Preserve SETTINGS_ENCRYPTION_KEY em backup seguro.'
);
