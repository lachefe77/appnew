const express = require('express');
const { db } = require('../db');

const router = express.Router();

router.get('/active', (req, res) => {
  const announcement = db.prepare('SELECT * FROM announcements WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get();
  res.json({ announcement });
});

module.exports = router;
