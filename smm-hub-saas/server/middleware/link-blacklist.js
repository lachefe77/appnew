const { db } = require('../db');

let cache = null;
let cacheTime = 0;
const CACHE_MS = 60_000;

function getPatterns() {
  const now = Date.now();
  if (!cache || now - cacheTime > CACHE_MS) {
    cache = db.prepare('SELECT pattern, reason FROM blocked_links').all();
    cacheTime = now;
  }
  return cache;
}

function invalidateCache() {
  cache = null;
}

function isBlocked(link) {
  if (!link) return null;
  const low = link.toLowerCase();
  for (const b of getPatterns()) {
    if (low.includes(b.pattern.toLowerCase())) return b;
  }
  return null;
}

module.exports = { isBlocked, invalidateCache };
