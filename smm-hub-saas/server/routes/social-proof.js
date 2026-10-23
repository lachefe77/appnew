const express = require('express');
const { db } = require('../db');

const router = express.Router();

router.get('/recent', (req, res) => {
  const allowSynSetting = db
    .prepare("SELECT value FROM settings WHERE key='allow_synthetic_proof'")
    .get();
  const allowSynthetic = false;

  const q = allowSynthetic
    ? `SELECT id, user_name, city, service_name, platform, quantity, time_ago, is_synthetic, created_at
       FROM social_proof_events ORDER BY id DESC LIMIT 15`
    : `SELECT id, user_name, city, service_name, platform, quantity, time_ago, is_synthetic, created_at
       FROM social_proof_events WHERE is_synthetic = 0 ORDER BY id DESC LIMIT 15`;
  res.json({ events: db.prepare(q).all() });
});

module.exports = router;
