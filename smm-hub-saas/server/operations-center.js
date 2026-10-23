const {db,tx}=require('./db');
function snapshot(){
 const jobs=db.prepare('SELECT status,COUNT(*) AS count FROM job_queue GROUP BY status').all();
 const uncertain=db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status='awaiting_confirmation'").get().n;
 const overdue=db.prepare("SELECT COUNT(*) AS n FROM job_queue WHERE status='pending' AND datetime(next_run)<datetime('now','-10 minutes')").get().n;
 const failed=jobs.find(row=>row.status==='failed')?.count||0;
 const conditions=[['jobs.failed',failed>0,'critical',failed+' trabalhos esgotaram as tentativas.'],['jobs.overdue',overdue>0,'warning',overdue+' trabalhos estão atrasados.'],['orders.uncertain',uncertain>0,'warning',uncertain+' pedidos precisam de conciliação com o fornecedor.']];
 tx(()=>{for(const [key,active,severity,message] of conditions){if(active)db.prepare('INSERT INTO operation_alerts(key,severity,message) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET severity=excluded.severity,message=excluded.message,updated_at=CURRENT_TIMESTAMP,resolved_at=NULL').run(key,severity,message);else db.prepare('UPDATE operation_alerts SET resolved_at=CURRENT_TIMESTAMP WHERE key=? AND resolved_at IS NULL').run(key);}});
 return {jobs,uncertain,overdue,alerts:db.prepare('SELECT * FROM operation_alerts WHERE resolved_at IS NULL ORDER BY opened_at').all(),integrations:{smtp:require('./config').smtp.enabled,payments_enabled:require('./config').pix?.provider!=='disabled'},updated_at:new Date().toISOString()};
}
function retryJob(id){
 const job=db.prepare("SELECT id,name,status FROM job_queue WHERE id=? AND status='failed'").get(id);
 if(!job)throw Object.assign(new Error('Trabalho inexistente ou ainda em execução.'),{status:409});
 if(!['mail','refund-order','settle-ambassador'].includes(job.name))throw Object.assign(new Error('Este trabalho exige conciliação específica; reenvio genérico bloqueado.'),{status:409});
 db.prepare("UPDATE job_queue SET status='pending',attempts=0,last_error=NULL,next_run=CURRENT_TIMESTAMP WHERE id=? AND status='failed'").run(id);
}
function start(){return require('./worker-lease').startLeased('operation-alerts',()=>snapshot(),60000);}
module.exports={snapshot,retryJob,start};
