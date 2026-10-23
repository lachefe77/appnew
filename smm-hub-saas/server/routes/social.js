const router=require('express').Router();const {requireAuth}=require('../auth');const {db}=require('../db');
router.get('/instagram/callback',async(req,res)=>{
 const cookie=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('smm_ig_browser='))?.slice('smm_ig_browser='.length);
 res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');
 try{await require('../social-connections').finish(req.query.state,cookie,req.query.code);res.clearCookie('smm_ig_browser',{path:'/api/social/instagram/callback'});res.redirect('/painel.html?instagram=connected#subscriptions');}catch{res.status(400).type('text').send('Não foi possível conectar o perfil. Volte ao painel e inicie uma nova conexão.');}
});
router.use(requireAuth);
router.get('/',(req,res)=>res.set('Cache-Control','no-store').json({connections:db.prepare('SELECT platform,username,expires_at,connected_at FROM social_connections WHERE user_id=?').all(req.user.id)}));
router.post('/instagram/start',(req,res)=>{try{const result=require('../social-connections').start(req.user.id);res.cookie('smm_ig_browser',result.browser,{httpOnly:true,secure:true,sameSite:'lax',path:'/api/social/instagram/callback',maxAge:600000});res.json({url:result.url});}catch(error){res.status(error.status||500).json({error:error.message});}});
router.delete('/instagram',(req,res)=>{db.prepare("DELETE FROM social_connections WHERE user_id=? AND platform='instagram'").run(req.user.id);res.json({message:'Conexão removida desta plataforma.'});});
module.exports=router;
