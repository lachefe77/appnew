const express = require('express');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.post('/validate', (req, res) => {
  const { code, order_amount_cents } = req.body;
  try {
    const { coupon, discount } = require('../coupon-domain').validateCoupon(
      req.user.id,
      code,
      Number(order_amount_cents)
    );
    return res.json({
      valid: true,
      code: coupon.code,
      discount_pct: coupon.discount_pct,
      discount_cents: discount,
      discount_formatted: `R$ ${(discount / 100).toFixed(2).replace('.', ',')}`,
      estimated: true,
    });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
});

module.exports = router;
