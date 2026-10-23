const express = require('express');
const { db } = require('../db');

const router = express.Router();

/**
 * List all SEO articles
 */
router.get('/', (req, res) => {
  try {
    const posts = db.prepare(`
      SELECT id, slug, title, meta_description, author, read_time_minutes, category, created_at
      FROM blog_posts
      ORDER BY id DESC
    `).all();

    res.json({ posts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get single article by slug
 */
router.get('/:slug', (req, res) => {
  try {
    const post = db.prepare('SELECT * FROM blog_posts WHERE slug = ?').get(req.params.slug);
    if (!post) {
      return res.status(404).json({ error: 'Artigo não encontrado.' });
    }
    res.json({ post });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
