const crypto=require('node:crypto');
function key(value){if(typeof value!=='string'||!/^[a-f0-9]{64}$/i.test(value))throw Error('A chave deve conter 64 caracteres hexadecimais.');return Buffer.from(value,'hex');}
function encrypt(value,secret){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(secret),iv);const body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return JSON.stringify({iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),body:body.toString('hex')});}
function decrypt(value,secret){const item=JSON.parse(value),cipher=crypto.createDecipheriv('aes-256-gcm',key(secret),Buffer.from(item.iv,'hex'));cipher.setAuthTag(Buffer.from(item.tag,'hex'));return Buffer.concat([cipher.update(Buffer.from(item.body,'hex')),cipher.final()]).toString('utf8');}
function rotate(db,previous,next,{apply=false}={}){
 key(previous);key(next);const changes=[];
 const has=table=>!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
 for(const [table,column] of [['users','two_factor_secret'],['providers','api_key'],['client_webhooks','secret'],['social_connections','token_cipher'],['child_panels','activation_secret_cipher']]){
   if(!has(table))continue;
   for(const row of db.prepare(`SELECT rowid AS row_id,${column} AS value FROM ${table} WHERE ${column} IS NOT NULL AND ${column}!=''`).all()){
     const plain=row.value.startsWith('v1:')?decrypt(row.value.slice(3),previous):row.value;
     changes.push({sql:`UPDATE ${table} SET ${column}=? WHERE rowid=?`,value:'v1:'+encrypt(plain,next),id:row.row_id});
   }
 }
 if(has('settings'))for(const name of ['pix.mp.accessToken','pix.mp.webhookSecret','crypto.nowpayments.apiKey','crypto.nowpayments.ipnSecret']){
   const id='integration:'+name,row=db.prepare('SELECT value FROM settings WHERE key=?').get(id);if(!row)continue;
   changes.push({sql:'UPDATE settings SET value=? WHERE key=?',value:encrypt(decrypt(row.value,previous),next),id});
 }
 if(has('job_queue'))for(const row of db.prepare("SELECT id,payload FROM job_queue WHERE name='mail' AND status!='completed'").all()){
   const payload=JSON.parse(row.payload);if(!payload.encrypted)continue;payload.encrypted=encrypt(decrypt(payload.encrypted,previous),next);changes.push({sql:'UPDATE job_queue SET payload=? WHERE id=?',value:JSON.stringify(payload),id:row.id});
 }
 if(apply){db.exec('BEGIN EXCLUSIVE');try{for(const item of changes)db.prepare(item.sql).run(item.value,item.id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
 return{records:changes.length,applied:apply,new_key_fingerprint:crypto.createHash('sha256').update(key(next)).digest('hex').slice(0,16)};
}
module.exports={rotate,encrypt,decrypt};
