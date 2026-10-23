const express = require('express');
const { resolve } = require('../graphql');
const { verifyToken, extractToken } = require('../auth');

const router = express.Router();

router.post('/', (req, res) => {
  const { query, variables, operationName } = req.body;
  const token = extractToken(req);
  const payload = token ? verifyToken(token) : null;
  if (token && !payload)
    return res.status(401).json({ error: 'Sessão inválida.' });
  if (payload?.sub_account_id || payload?.delegated_by)
    return res
      .status(403)
      .json({ error: 'Use a API de pedidos com as permissões da sessão.' });
  const result = resolve(
    query,
    { userId: payload?.id, role: payload?.role },
    variables,
    operationName
  );
  res.json(result);
});

router.get('/', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>GraphiQL Mini</title>
    <style>body{font-family:system-ui;padding:40px;background:#0b0f17;color:#fff}
    textarea{width:100%;height:200px;background:#111827;color:#fff;border:1px solid #334155;padding:12px;border-radius:8px;font-family:monospace}
    button{padding:10px 20px;background:#06b6d4;color:#000;border:0;border-radius:6px;font-weight:bold;cursor:pointer;margin-top:10px}
    pre{background:#111827;padding:16px;border-radius:8px;overflow:auto}</style></head>
    <body><h1>GraphQL — SMM Hub</h1>
    <textarea id="q">{ services { id name platform } }</textarea><br>
    <button onclick="run()">Executar</button>
    <pre id="out">—</pre>
    <script>async function run(){const t=localStorage.getItem('smm_token');const r=await fetch('/api/graphql',{method:'POST',headers:{'Content-Type':'application/json','Authorization':t?'Bearer '+t:''},body:JSON.stringify({query:document.getElementById('q').value})});document.getElementById('out').textContent=JSON.stringify(await r.json(),null,2)}</script>
    </body></html>`);
});

module.exports = router;
