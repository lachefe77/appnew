const config=require('./config');const marker='browser-session';
function write(req,res,token){
 if(req.get('X-Session-Transport')!=='cookie')return token;
 const payload=require('jsonwebtoken').decode(token);
 res.cookie('smm_session',token,{httpOnly:true,secure:config.env==='production',sameSite:'strict',path:'/api',maxAge:Math.max(0,payload.exp*1000-Date.now())});
 res.set('Cache-Control','no-store');return marker;
}
function read(req){
 if(req.get('Authorization')!=='Bearer '+marker)return null;
 if(req.get('Origin')){const expected=config.publicUrl?new URL(config.publicUrl).origin:req.protocol+'://'+req.get('host');if(req.get('Origin')!==expected)return null;}
 const value=String(req.headers.cookie||'').split(';').map(item=>item.trim()).find(item=>item.startsWith('smm_session='));return value?value.slice('smm_session='.length):null;
}
module.exports={write,read,marker};
