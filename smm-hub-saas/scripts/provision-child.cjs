const fs=require('node:fs'),path=require('node:path');const {db}=require('../server/db');
const id=Number(process.env.CHILD_PANEL_ID),output=path.resolve(process.env.CHILD_OUTPUT||'deployments/child-'+id);
const panel=db.prepare("SELECT * FROM child_panels WHERE id=? AND status!='canceled'").get(id);if(!panel)throw Error('Solicitação de subpainel não encontrada.');
const options={appImage:process.env.CHILD_APP_IMAGE,proxyImage:process.env.CHILD_PROXY_IMAGE,adminEmail:process.env.CHILD_ADMIN_EMAIL,networkPrefix:process.env.CHILD_NETWORK_PREFIX};
const origin=require('../config').publicUrl,user=db.prepare("SELECT api_key FROM users WHERE id=? AND status='active'").get(panel.user_id);if(origin&&user){options.upstreamUrl=origin;options.upstreamKey=user.api_key;}
const result=require('../server/child-deployment').bundle(panel,options);if(fs.existsSync(output))throw Error('A pasta de destino já existe. Não sobrescreva segredos de uma instalação.');
fs.mkdirSync(output,{recursive:true,mode:0o700});for(const [name,content] of Object.entries(result.files))fs.writeFileSync(path.join(output,name),content,{flag:'wx',mode:0o600});
db.prepare("UPDATE child_panels SET activation_secret_cipher=?,status='pending_provisioning' WHERE id=? AND status!='canceled'").run(require('../factor-secret').seal(result.activationSecret),id);db.close();console.log('Arquivos de instalação gerados em '+output+'. Nenhum container iniciado; nenhum valor cobrado.');
