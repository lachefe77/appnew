const router = require('express').Router();
const { db } = require('../db');
const { requireAdmin } = require('../auth');
router.use(requireAdmin);
const tables = {
  scheduled: 'scheduled_orders',
  giveaways: 'giveaways',
  challenges: 'challenges',
  combos: 'combos',
  invoices: 'invoices_nf',
  jobs: 'job_queue',
};
router.get('/operations/:resource', (req, res) => {
  const table = tables[req.params.resource];
  if (!table) return res.status(404).json({ error: 'Recurso não encontrado.' });
  const columns =
    table === 'job_queue'
      ? 'id,name,status,attempts,next_run,completed_at,last_error'
      : '*';
  const sort = table === 'job_queue' ? 'created_at' : 'id';
  res.json({
    rows: db
      .prepare(
        `SELECT ${columns} FROM ${table} ORDER BY ${sort} DESC LIMIT 100`
      )
      .all(),
  });
});
module.exports = router;
router.post(
  '/ambassadors/:id/approve',
  require('../auth').requireCEO,
  (req, res) => {
    const pct = Number(req.body.discount_pct),
      commission = Number(req.body.commission_pct);
    if (
      !Number.isFinite(pct) ||
      pct < 0 ||
      pct > 25 ||
      !Number.isFinite(commission) ||
      commission < 0 ||
      commission > 10
    )
      return res
        .status(400)
        .json({ error: 'Limites: desconto 0–25%, comissão 0–10%.' });
    const row = db
      .prepare('SELECT * FROM ambassador_coupons WHERE id=?')
      .get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Cupom não encontrado.' });
    try {
      require('../db').tx(() => {
        let couponId=row.coupon_id;
        if(couponId)db.prepare("UPDATE coupons SET discount_pct=?,status='active' WHERE id=? AND code=?").run(pct,couponId,row.code);
        else couponId=Number(db.prepare("INSERT INTO coupons(code,discount_pct,max_uses,status) VALUES(?,?,1000,'active')").run(row.code,pct).lastInsertRowid);
        db.prepare(
          "UPDATE ambassador_coupons SET discount_pct=?,commission_pct=?,coupon_id=?,status='active' WHERE id=?"
        ).run(pct, commission, couponId,row.id);
      });
      res.json({ message: 'Campanha aprovada.' });
    } catch {
      res.status(400).json({ error: 'Não foi possível aprovar a campanha.' });
    }
  }
);
