const { db, tx } = require('./db');
function plan(input, service, quantity) {
  if (![undefined, null, false, 0, '0', true, 1, '1'].includes(input.is_dripfeed)) throw Object.assign(new Error('Entrega parcelada inválida.'),{status:400});
  if (!input.is_dripfeed || input.is_dripfeed === '0') return null;
  const runs=Number(input.dripfeed_runs), interval=Number(input.dripfeed_interval);
  if(!service.dripfeed_available || service.type==='custom_comments' || !Number.isSafeInteger(runs)||runs<2||runs>100||!Number.isSafeInteger(interval)||interval<1||interval>10080||Math.floor(quantity/runs)<service.min_quantity||Math.ceil(quantity/runs)>service.max_quantity) throw Object.assign(new Error('Lotes inválidos: 2 a 100 lotes, intervalo de 1 a 10080 minutos e quantidade por lote dentro dos limites do serviço.'),{status:400});
  return {runs,interval,quantities:Array.from({length:runs},(_,i)=>Math.floor(quantity/runs)+(i<quantity%runs?1:0))};
}
function initialize(orderId, definition) {
  if(!definition)return;
  db.prepare('UPDATE orders SET is_dripfeed=1,dripfeed_runs=?,dripfeed_interval=? WHERE id=?').run(definition.runs,definition.interval,orderId);
  definition.quantities.forEach((qty,index)=>db.prepare('INSERT INTO drip_batches(order_id,run,quantity,remains,due_at) VALUES(?,?,?,?,?)').run(orderId,index+1,qty,qty,new Date().toISOString()));
}
function current(orderId) {return db.prepare("SELECT * FROM drip_batches WHERE order_id=? AND status IN ('pending','submitted') ORDER BY run LIMIT 1").get(orderId);}
function ready(order) {
  if(!order.is_dripfeed)return true;
  const batch=current(order.id);
  return !!db.prepare("SELECT id FROM users WHERE id=? AND status='active' AND deleted_at IS NULL").get(order.user_id) && !!batch && batch.status==='pending' && Date.parse(batch.due_at.includes('T')?batch.due_at:batch.due_at.replace(' ','T')+'Z')<=Date.now() && !require('./automation-domain').isUserOnVacation(order.user_id);
}
function accepted(orderId,remoteId,providerId) {
  const batch=current(orderId);if(!batch)return;
  db.prepare("UPDATE drip_batches SET status='submitted',remote_id=?,provider_id=? WHERE order_id=? AND run=? AND status='pending'").run(String(remoteId),providerId,orderId,batch.run);
}
function progress(order, remoteId, data) {
  {
    const batch=current(order.id);
    if(!batch || batch.status!=='submitted' || batch.remote_id!==String(remoteId))return {applied:false};
    const remote=String(data.status||'').trim().toLowerCase();
    const status=({completed:'completed',partial:'partial',canceled:'canceled',cancelled:'canceled',refunded:'canceled','in progress':'in_progress',processing:'in_progress',pending:'processing'})[remote];
    if(!status)return {applied:false};
    const remains=status==='completed'?0:status==='canceled'?batch.quantity:Number(data.remains ?? (remote==='pending'?batch.quantity:NaN));
    if(!Number.isSafeInteger(remains)||remains<0||remains>batch.quantity)throw new Error('Quantidade restante do lote inválida.');
    db.prepare('UPDATE drip_batches SET remains=?,status=?,completed_at=? WHERE order_id=? AND run=?').run(remains,['completed','partial','canceled'].includes(status)?status:'submitted',status==='completed'?new Date().toISOString():null,order.id,batch.run);
    const delivered=db.prepare('SELECT COALESCE(SUM(quantity-remains),0) AS n FROM drip_batches WHERE order_id=?').get(order.id).n;
    const totalRemains=order.quantity-delivered;
    let nextStatus=status;
    if(status==='completed' && batch.run<order.dripfeed_runs){
      nextStatus='pending';
      db.prepare('UPDATE drip_batches SET due_at=? WHERE order_id=? AND run=?').run(new Date(Date.now()+order.dripfeed_interval*60000).toISOString(),order.id,batch.run+1);
    }
    if(status==='partial'||status==='canceled'){
      nextStatus=delivered>0?'partial':'canceled';
      db.prepare("UPDATE drip_batches SET status='canceled' WHERE order_id=? AND run>? AND status='pending'").run(order.id,batch.run);
    }
    db.prepare('UPDATE orders SET status=?,remains=?,remote_order_id=?,dripfeed_completed_runs=(SELECT COUNT(*) FROM drip_batches WHERE order_id=? AND status=\'completed\'),updated_at=CURRENT_TIMESTAMP WHERE id=?').run(nextStatus,totalRemains,nextStatus==='pending'?null:String(remoteId),order.id,order.id);
    db.prepare("INSERT INTO order_events(order_id,event_type,payload_json) VALUES(?,'drip.progress',?)").run(order.id,JSON.stringify({run:batch.run,status,remains:totalRemains}));
    if(nextStatus==='partial'||nextStatus==='canceled')require('./job-queue').enqueue('refund-order',{orderId:order.id,partial:nextStatus==='partial',remains:totalRemains},{id:'refund:'+order.id+':drip'});
    return {applied:true,status:nextStatus};
  }
}
function reject(orderId) {
  const order=db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if(!order?.is_dripfeed)return false;
  tx(()=>{
    const delivered=db.prepare('SELECT COALESCE(SUM(quantity-remains),0) AS n FROM drip_batches WHERE order_id=?').get(orderId).n;
    db.prepare("UPDATE drip_batches SET status='canceled' WHERE order_id=? AND status IN ('pending','submitted')").run(orderId);
    db.prepare('UPDATE orders SET status=?,remains=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(delivered?'partial':'failed',order.quantity-delivered,orderId);
    require('./job-queue').enqueue('refund-order',{orderId,partial:delivered>0,remains:order.quantity-delivered},{id:'refund:'+orderId+':drip-rejected'});
  });
  const updated=db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  require('./smm-engine').refundOrder(orderId,updated.status==='partial',updated.remains);
  return true;
}
module.exports={plan,initialize,current,ready,accepted,progress,reject};
