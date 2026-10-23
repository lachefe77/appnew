const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {db,hashPassword}=require('../db');
const {placeOrder}=require('../order-domain');const {dispatchOrder,handleOrderCompleted}=require('../smm-engine');
const {applyProviderStatus}=require('../order-reconciliation');
function fixture(){
 const h=hashPassword('Drip-test-123');const user=Number(db.prepare("INSERT INTO users(uuid,name,email,password_hash,salt,api_key,balance_cents) VALUES(?,'Drip',?,?,?,?,100000)").run(crypto.randomUUID(),crypto.randomUUID()+'@test.invalid',h.hash,h.salt,crypto.randomUUID()).lastInsertRowid);
 const service=db.prepare("SELECT s.* FROM services s JOIN providers p ON p.id=s.provider_id WHERE s.status='active' AND p.is_mock=1 AND s.type!='custom_comments' LIMIT 1").get();db.prepare('UPDATE services SET dripfeed_available=1 WHERE id=?').run(service.id);
 return {user,service,input:{service_id:service.id,link:'https://example.com/drip',quantity:service.min_quantity*3+1,is_dripfeed:1,dripfeed_runs:3,dripfeed_interval:15}};
}
test('Entrega parcelada preserva total, intervalo, débito único e conclusão única',async()=>{
 const f=fixture(),order=placeOrder(f.user,f.input);const batches=db.prepare('SELECT * FROM drip_batches WHERE order_id=?').all(order.id);assert.equal(batches.reduce((sum,b)=>sum+b.quantity,0),f.input.quantity);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id=? AND type='order_debit'").get(f.user).n,1);
 for(let run=1;run<=3;run++){
   const response=await dispatchOrder(order.id);assert.equal(response.success,true);const before=db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);assert.equal((await dispatchOrder(order.id)).success,false);
   const result=applyProviderStatus(order.id,response.remote_order_id,{status:'Completed',remains:0});assert.equal(result.status,run===3?'completed':'pending');
   assert.equal(applyProviderStatus(order.id,response.remote_order_id,{status:'Completed',remains:0}).applied,false);
   if(run<3){assert.equal((await dispatchOrder(order.id)).success,false);db.prepare("UPDATE drip_batches SET due_at=datetime('now','-1 minute') WHERE order_id=? AND run=?").run(order.id,run+1);}
   assert.ok(before.remains>0);
 }
 await handleOrderCompleted(order.id);await handleOrderCompleted(order.id);assert.equal(db.prepare('SELECT remains FROM orders WHERE id=?').get(order.id).remains,0);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE reference_id=? AND type='cashback'").get(order.uuid).n,1);
});
test('Rejeição de lote posterior estorna só a parte não entregue',async()=>{
 const f=fixture(),order=placeOrder(f.user,f.input);const response=await dispatchOrder(order.id);applyProviderStatus(order.id,response.remote_order_id,{status:'Completed'});require('../drip-domain').reject(order.id);require('../drip-domain').reject(order.id);
 const remaining=db.prepare('SELECT remains,status FROM orders WHERE id=?').get(order.id);assert.equal(remaining.status,'partial');assert.equal(db.prepare("SELECT SUM(amount_cents) AS n FROM transactions WHERE reference_id=? AND type='order_refund'").get(order.uuid).n,Math.round(order.charge_cents*remaining.remains/order.quantity));
 assert.throws(()=>placeOrder(f.user,{...f.input,dripfeed_interval:0}));assert.throws(()=>placeOrder(f.user,{...f.input,quantity:f.service.min_quantity}));
});
