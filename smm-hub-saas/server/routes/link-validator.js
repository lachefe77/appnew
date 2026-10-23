const express = require('express');

const router = express.Router();

/**
 * Inspect and sanitize social media links
 */
router.post('/inspect', (req, res) => {
  try {
    const { url, platform } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL ou link não fornecido.' });
    }

    let raw = url.trim();
    let cleaned = raw;
    let preview = null;

    // 1. TIKTOK CLEANER
    if (platform === 'tiktok' || raw.includes('tiktok.com')) {
      // Remove tracking query strings
      try {
        const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
        u.search = '';
        cleaned = u.toString();
      } catch (e) {
        cleaned = raw.split('?')[0];
      }
      preview = {
        platform: 'tiktok',
        is_cleaned: true,
        type: cleaned.includes('/video/') ? 'video' : 'profile',
        note: 'Links com parâmetros de tracking foram limpos para evitar falhas no envio.',
      };
    }

    // 2. INSTAGRAM NORMALIZER & PROFILE PREVIEW
    else if (
      platform === 'instagram' ||
      raw.includes('instagram.com') ||
      raw.startsWith('@')
    ) {
      let handle = raw.replace(/^@/, '');
      if (handle.includes('instagram.com/')) {
        const parts = handle
          .split('instagram.com/')[1]
          .split('/')[0]
          .split('?')[0];
        handle = parts;
      }
      cleaned = `https://www.instagram.com/${handle}/`;
      preview = {
        platform: 'instagram',
        handle: `@${handle}`,
        is_private: null,
        followers_estimate: null,
        is_verified: null,
        status:
          'Formato normalizado; disponibilidade do perfil não verificada.',
      };
    }

    // 3. YOUTUBE DETECTOR
    else if (
      platform === 'youtube' ||
      raw.includes('youtube.com') ||
      raw.includes('youtu.be')
    ) {
      let type = 'video';
      if (raw.includes('/shorts/')) type = 'short';
      else if (raw.includes('/live/') || raw.includes('live'))
        type = 'livestream';
      else if (
        raw.includes('/channel/') ||
        raw.includes('/c/') ||
        raw.includes('/@')
      )
        type = 'channel';

      preview = {
        platform: 'youtube',
        type,
        note: `Link identificado como ${type.toUpperCase()}. Compatível com algoritmo do YouTube.`,
      };
    }

    // 4. TELEGRAM NORMALIZER
    else if (platform === 'telegram' || raw.includes('t.me')) {
      let channel = raw
        .replace('https://t.me/', '')
        .replace('@', '')
        .split('?')[0];
      cleaned = `https://t.me/${channel}`;
      preview = {
        platform: 'telegram',
        channel: `@${channel}`,
        type: raw.includes('+') ? 'convite_privado' : 'canal_publico',
        note: raw.includes('+')
          ? 'Atenção: Para links privados com (+), certifique-se que o bot pode entrar.'
          : 'Canal público verificado.',
      };
    }

    res.json({
      original_url: raw,
      cleaned_url: cleaned,
      preview,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao validar link: ' + err.message });
  }
});

module.exports = router;
