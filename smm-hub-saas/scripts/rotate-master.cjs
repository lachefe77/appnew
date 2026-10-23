require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path');const {DatabaseSync,backup}=require('node:sqlite');
const apply=process.argv.includes('--apply');
if(apply&&!process.argv.includes('--offline'))throw Error('Pare o servidor e use --offline --apply. Primeiro execute a prévia sem --apply.');
const source=path.resolve(process.env.DB_PATH||'data.sqlite');if(!fs.existsSync(source))throw Error('Banco inexistente.');
const db=new DatabaseSync(source,{readOnly:!apply});const {rotate}=require('../server/secret-rotation');
(async()=>{const args=[db,process.env.SETTINGS_ENCRYPTION_KEY,process.env.NEW_SETTINGS_ENCRYPTION_KEY];const preview=rotate(...args);if(apply){const directory=path.resolve('backups');fs.mkdirSync(directory,{recursive:true});await backup(db,path.join(directory,'pre-master-'+Date.now()+'.sqlite'));console.log(JSON.stringify(rotate(...args,{apply:true})));}else console.log(JSON.stringify(preview));db.close();})().catch(()=>{db.close();console.error('Rotação não concluída. Verifique as chaves e o backup; nenhum segredo foi impresso.');process.exitCode=1;});
