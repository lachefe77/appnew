const router=require('express').Router();const {db,tx}=require('../db');const {requireAdmin,requireCEO}=require('../auth');
router.use(requireAdmin);
router.post('/child-panels/:id/activate',requireCEO,async(req,res)=>{try{const result=await require('../child-provisioning').activate(req.params.id);audit(req,'child_activate',req.params.id);res.json(result);}catch(error){res.status(error.status||400).json({error:error.status?error.message:'HTTPS ou instalação ainda indisponível.'});}});
function audit(req,action,id){db.prepare('INSERT INTO system_audit_logs(admin_id,action,target,ip,details) VALUES(?,?,?,?,?)').run(req.user.id,action,String(id),req.ip,'Operação administrativa');}
router.get('/summary',(req,res)=>res.set('Cache-Control','no-store').json(require('../operations-center').snapshot()));
router.post('/mail/verify',requireCEO,async(req,res)=>{try{res.json(await require('../mail').verifyTransport());audit(req,'smtp_verify','smtp');}catch(error){res.status(error.status||502).json({error:error.status?error.message:'Falha na verificação SMTP. Confira endereço, TLS e credenciais na configuração.'});}});
const resources={children:{table:'child_panels',columns:'id,user_id,domain,panel_name,status,ownership_verified_at,provisioned_at',sort:'id'},jobs:{table:'job_queue',columns:'id,name,status,attempts,next_run,last_error,created_at',sort:'id'},mail:{table:'job_queue',columns:'id,name,status,attempts,next_run,last_error,created_at',where:"name='mail'",sort:'id'},providers:{table:'providers',columns:'id,name,api_url,currency,exchange_rate,status,is_mock',sort:'id'},campaigns:{table:'ambassador_coupons',columns:'id,user_id,code,discount_pct,commission_pct,status,total_commissions_cents',sort:'id'},commissions:{table:'ambassador_order_commissions',columns:'order_id,ambassador_id,amount_cents,status,settles_at,paid_at',sort:'order_id'},audit:{table:'system_audit_logs',columns:'id,admin_id,action,target,created_at',sort:'id'}};
router.get('/:resource',(req,res)=>{
 const r=resources[req.params.resource];if(!r)return res.status(404).json({error:'Área não encontrada.'});
 const limit=Number(req.query.limit??25);if(!Number.isSafeInteger(limit)||limit<1||limit>100)return res.status(400).json({error:'Limite deve ser inteiro entre 1 e 100.'});
 const cursor=req.query.cursor; if(cursor!=null&&(typeof cursor!=='string'||cursor.length>100))return res.status(400).json({error:'Cursor inválido.'});
 const conditions=[r.where,cursor?`${r.sort} < ?`:null].filter(Boolean),args=cursor?[cursor,limit+1]:[limit+1];
 const rows=db.prepare(`SELECT ${r.columns} FROM ${r.table} ${conditions.length?'WHERE '+conditions.join(' AND '):''} ORDER BY ${r.sort} DESC LIMIT ?`).all(...args);const more=rows.length>limit;if(more)rows.pop();res.json({rows,next_cursor:more?String(rows.at(-1)[r.sort]):null});
});
router.post('/jobs/:id/retry',requireCEO,(req,res)=>{try{tx(()=>{require('../operations-center').retryJob(req.params.id);audit(req,'retry_job',req.params.id);});res.json({message:'Trabalho recolocado na fila.'});}catch(error){res.status(error.status||500).json({error:error.status?error.message:'Operação não concluída.'});}});
router.put('/providers/:id',requireCEO,async(req,res)=>{
 try{
  const row=db.prepare('SELECT * FROM providers WHERE id=?').get(req.params.id);if(!row)return res.status(404).json({error:'Fornecedor não encontrado.'});
  const {name,api_url,status,exchange_rate,api_key}=req.body;
  if(typeof name!=='string'||name.trim().length<2||name.length>120||!['active','inactive'].includes(status)||typeof api_url!=='string'||api_url.length>2048||typeof exchange_rate!=='number'||!Number.isFinite(exchange_rate)||exchange_rate<=0||exchange_rate>10000||(api_key!=null&&(typeof api_key!=='string'||api_key.length>4096)))return res.status(400).json({error:'Dados de fornecedor inválidos.'});
  if(!row.is_mock)await require('../webhook-http').resolveWebhook(api_url);
  if(row.api_url!==api_url && db.prepare("SELECT id FROM orders WHERE provider_id=? AND status IN ('dispatching','processing','in_progress','awaiting_confirmation') LIMIT 1").get(row.id))return res.status(409).json({error:'Existem pedidos em andamento. Concilie antes de alterar o endereço.'});
  tx(()=>{db.prepare('UPDATE providers SET name=?,api_url=?,status=?,exchange_rate=?,api_key=? WHERE id=?').run(name.trim(),api_url,status,exchange_rate,api_key?require('../provider-client').sealKey(api_key):row.api_key,row.id);audit(req,'provider_update',row.id);});res.json({message:'Fornecedor atualizado.'});
 }catch(error){res.status(400).json({error:'Não foi possível validar e salvar o fornecedor.'});}
});
router.post('/campaigns/:id/pause',requireCEO,(req,res)=>{const row=db.prepare('SELECT * FROM ambassador_coupons WHERE id=?').get(req.params.id);if(!row)return res.status(404).json({error:'Campanha não encontrada.'});tx(()=>{db.prepare("UPDATE ambassador_coupons SET status='paused' WHERE id=?").run(row.id);db.prepare("UPDATE coupons SET status='inactive' WHERE code=?").run(row.code);audit(req,'campaign_pause',row.id);});res.json({message:'Campanha pausada.'});});
module.exports=router;
