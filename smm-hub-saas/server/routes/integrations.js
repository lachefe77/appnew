const router = require('express').Router();
const { requireCEO } = require('../auth');
const { db, verifyPassword } = require('../db');
const { fields, write } = require('../runtime-config');
const config = require('../config');
router.use(requireCEO);
router.get('/', (req, res) => {
  const result = {};
  for (const [key, spec] of Object.entries(fields)) {
    let value = config;
    try {
      for (const part of key.split('.')) value = value[part];
      result[key] = spec.secret ? { configured: !!value } : { value };
    } catch {
      result[key] = {
        configured: false,
        error: 'Não foi possível descriptografar a configuração.',
      };
    }
  }
  res.json({
    fields: result,
    encrypted_storage_ready: /^[0-9a-f]{64}$/i.test(
      process.env.SETTINGS_ENCRYPTION_KEY || ''
    ),
  });
});
router.put('/', (req, res) => {
  const { password, values } = req.body || {};
  if (
    typeof password !== 'string' ||
    !values ||
    typeof values !== 'object' ||
    Array.isArray(values)
  )
    return res
      .status(400)
      .json({ error: 'Senha e configurações são obrigatórias.' });
  const user = db
    .prepare('SELECT password_hash,salt FROM users WHERE id=?')
    .get(req.user.id);
  if (!verifyPassword(password, user.password_hash, user.salt))
    return res.status(401).json({ error: 'Senha inválida.' });
  try {
    write(values);
    db.prepare(
      "INSERT INTO system_audit_logs(admin_id,action,target,ip,details) VALUES(?,'integration_update','integrations',?,?)"
    ).run(req.user.id, req.ip, JSON.stringify(Object.keys(values)));
    res.json({
      message:
        'Configurações salvas. Valide o gateway em homologação antes de receber pagamentos.',
    });
  } catch {
    res.status(400).json({
      error:
        'Configuração inválida. Confira URL, provedor e chave de criptografia do servidor.',
    });
  }
});
module.exports = router;
