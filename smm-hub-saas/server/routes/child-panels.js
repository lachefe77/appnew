const express = require('express');
const { db, tx } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const CHILD_PANEL_MONTHLY_CENTS = 4990;

router.post('/', (req, res) => {
  const { domain, panel_name, currency, admin_user } = req.body;
  if (
    [domain, panel_name, admin_user].some(
      (value) =>
        typeof value !== 'string' || !value.trim() || value.length > 253
    )
  )
    return res
      .status(400)
      .json({ error: 'Domínio, nome e admin obrigatórios e válidos.' });

  const cleanDomain = domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .trim();
  if (
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      cleanDomain
    ) ||
    (currency && currency !== 'BRL')
  )
    return res
      .status(400)
      .json({ error: 'Informe um domínio válido e moeda BRL.' });

  const result = tx(() => {
    if (
      db
        .prepare(
          "SELECT id FROM child_panels WHERE domain=? AND status!='canceled'"
        )
        .get(cleanDomain)
    )
      return { err: 'Domínio já possui uma solicitação em andamento.' };
    const renews = null;
    const r = db
      .prepare(
        `INSERT INTO child_panels (user_id, domain, panel_name, currency, admin_user, price_monthly_cents, renews_at, status)
      VALUES (?,?,?,?,?,?,?, 'pending_provisioning')`
      )
      .run(
        req.user.id,
        cleanDomain,
        panel_name.trim(),
        currency || 'BRL',
        admin_user.trim(),
        CHILD_PANEL_MONTHLY_CENTS,
        renews
      );
    return { id: r.lastInsertRowid, renews };
  });

  if (result.err) return res.status(400).json({ error: result.err });

  res.status(201).json({
    message: `Solicitação para ${cleanDomain} registrada, sem cobrança. Aguarda configuração de domínio, TLS e infraestrutura.`,
    child_panel_id: result.id,
    status: 'pending_provisioning',
    renews_at: result.renews,
    charged_cents: 0,
  });
});

router.get('/', (req, res) => {
  res.json({
    panels: db
      .prepare(`SELECT id,domain,panel_name,currency,admin_user,price_monthly_cents,renews_at,status,created_at,ownership_verified_at,provisioned_at FROM child_panels WHERE user_id = ? ORDER BY id DESC LIMIT 100`)
      .all(req.user.id),
  });
});
router.get('/:id/dns',(req,res)=>{try{const row=require('../child-provisioning').ownership(req.params.id,req.user.id);res.json({type:'TXT',name:'_smmhub.'+row.domain,value:'smmhub-verification='+row.dns_token});}catch(error){res.status(error.status||400).json({error:error.message});}});
router.post('/:id/verify',async(req,res)=>{try{res.json(await require('../child-provisioning').verify(req.params.id,req.user.id));}catch(error){res.status(error.status||400).json({error:error.status?error.message:'Não foi possível consultar o DNS. Confira o domínio e tente novamente.'});}});

router.delete('/:id', (req, res) => {
  const r = db
    .prepare(
      `UPDATE child_panels SET status='canceled' WHERE id = ? AND user_id = ?`
    )
    .run(req.params.id, req.user.id);
  if (r.changes === 0)
    return res.status(404).json({ error: 'Painel não encontrado.' });
  res.json({ message: 'Painel cancelado.' });
});

module.exports = router;
