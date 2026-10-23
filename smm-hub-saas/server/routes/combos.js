const router = require('express').Router();
const domain = require('../combo-domain');
const { requireAuth } = require('../auth');
router.use(requireAuth);
router.get('/', (req, res) => res.json({ combos: domain.list() }));
router.post('/:id/purchase', (req, res) => {
  try {
    const result = domain.purchase(req.user.id, req.params.id, req.body);
    if (!result.repeated)
      for (const orderId of result.order_ids)
        require('../order-notices').touch(orderId);
    for (const orderId of result.order_ids)
      require('../job-queue').enqueue(
        'dispatch',
        { orderId },
        { id: 'dispatch:' + orderId },
      );
    res
      .status(result.repeated ? 200 : 201)
      .json({
        message: 'Combo comprado. Acompanhe cada item em Meus pedidos.',
        ...result,
      });
  } catch (error) {
    res
      .status(error.status || 500)
      .json({
        error: error.status
          ? error.message
          : 'Não foi possível concluir a compra do combo.',
      });
  }
});
module.exports = router;
