module.exports = (req, res, next) => {
  for (const [key, max, min] of [
    ['limit', 200, 1],
    ['offset', 100000, 0],
    ['days', 365, 1],
  ])
    if (req.query[key] !== undefined) {
      const n = Number(req.query[key]);
      if (
        typeof req.query[key] !== 'string' ||
        !Number.isSafeInteger(n) ||
        n < min ||
        n > max
      )
        return res.status(400).json({ error: 'Paginação inválida.' });
    }
  if (
    req.query.search !== undefined &&
    (typeof req.query.search !== 'string' || req.query.search.length > 200)
  )
    return res.status(400).json({ error: 'Busca inválida.' });
  if (
    req.body &&
    !Buffer.isBuffer(req.body) &&
    (typeof req.body !== 'object' || Array.isArray(req.body))
  )
    return res.status(400).json({ error: 'Objeto JSON esperado.' });
  next();
};
