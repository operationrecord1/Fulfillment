const {test}=require('node:test');
const assert=require('node:assert/strict');
const {orderStatus}=require('./ebay-presentation.js');
const row=(status,data={},extra={})=>({data,edit:{data:{status,...extra}}});
test('buy ID and buying price advance pending',()=>{
 assert.equal(orderStatus(row('Pending',{}, {purchase_id:'114-1234567-1234567'})),'Ordered');
 assert.equal(orderStatus(row('Pending',{}, {buy_price:3})),'Ordered');
});
test('hard lock exceptions block every imported event',()=>{
 for(const status of ['Alert','OOS'])for(const data of [{orderFulfillmentStatus:'FULFILLED'},{cancelStatus:{cancelState:'CANCELED'}}])
 assert.equal(orderStatus(row(status,data,{purchase_id:'buy'})),status);
});
test('clearing an exception resumes the current imported state',()=>{
 const r=row('Alert',{orderFulfillmentStatus:'FULFILLED'});
 assert.equal(orderStatus(r),'Alert');r.edit.data.status='';assert.equal(orderStatus(r),'Shipped');
 r.data.cancelStatus={cancelState:'CANCELED'};assert.equal(orderStatus(r),'Cancelled');
});
test('fulfilled never claims delivered and cancellation requests are not cancellations',()=>{
 assert.equal(orderStatus(row('Pending',{orderFulfillmentStatus:'FULFILLED'})),'Shipped');
 assert.equal(orderStatus(row('Pending',{cancelStatus:{cancelState:'IN_PROGRESS'}})),'Pending');
});
test('normal manual stages reconcile to imported shipment',()=>{
 for(const s of ['Delivered','Label Created'])assert.equal(orderStatus(row(s,{orderFulfillmentStatus:'FULFILLED'})),'Shipped');
});

test('only active return delivery triggers due refund; label and outgoing shipment stay distinct',()=>{
const r=row('Ordered',{orderFulfillmentStatus:'FULFILLED'});r.returns=[{state:'ITEM_SHIPPED',tracking:{active:true,labelDate:{value:'2026-11-18T09:29:37Z'},deliveryStatus:'IN_TRANSIT'}}];
assert.equal(orderStatus(r),'Label Created');r.returns[0].tracking.deliveryStatus='DELIVERED';assert.equal(orderStatus(r),'Due Refund');r.edit.data.status='Alert';assert.equal(orderStatus(r),'Alert');r.edit.data.status='';r.returns[0].tracking.active=false;assert.equal(orderStatus(r),'Shipped');
});

test('confirmed full refund supersedes delivery and return stages while preserving manual exception locks',()=>{
 for(const status of ['Pending','Ordered','Shipped','Delivered','Label Created','Cancelled','']){
 const r=row(status,{orderPaymentStatus:'FULLY_REFUNDED',orderFulfillmentStatus:'FULFILLED'});
 r.delivery={source:'ebay_get_orders',deliveredAt:'2026-11-20T00:00:00Z'};
 r.returns=[{state:'ITEM_SHIPPED',tracking:{active:true,deliveryStatus:'DELIVERED'}}];
 assert.equal(orderStatus(r),'Refunded');
 }
 for(const status of ['Alert','OOS'])assert.equal(orderStatus(row(status,{orderPaymentStatus:'FULLY_REFUNDED'})),status);
});
test('partial, pending or failed refunds and zero earnings do not imply a full refund',()=>{
 for(const payment of ['PARTIALLY_REFUNDED','REFUND_PENDING','FAILED','PAID']){
 const r=row('Ordered',{orderPaymentStatus:payment},{purchase_id:'buy'});r.earnings={value:0};
 assert.equal(orderStatus(r),'Ordered');
 }
});

test('Due Refund blocks normal stages but allows terminal events',()=>{
const r=row('Due Refund',{orderFulfillmentStatus:'FULFILLED'},{purchase_id:'buy'});
r.delivery={source:'ebay_get_orders',deliveredAt:'2026-11-20T00:00:00Z'};
r.returns=[{state:'OPEN',tracking:{active:true,labelDate:{value:'2026-11-18'}}}];
assert.equal(orderStatus(r),'Due Refund');
r.data.cancelStatus={cancelState:'CANCELED'};assert.equal(orderStatus(r),'Cancelled');
r.data.orderPaymentStatus='FULLY_REFUNDED';assert.equal(orderStatus(r),'Cancelled');
delete r.data.cancelStatus;assert.equal(orderStatus(r),'Refunded');
});
test('normal overrides resolve to buy ID or Pending without modifying earnings',()=>{
for(const status of ['Ordered','Shipped','Delivered','Cancelled','Label Created']){
const r=row(status);r.earnings={value:29.49};const before=JSON.stringify(r);
assert.equal(orderStatus(r),'Pending');assert.equal(JSON.stringify(r),before);
r.edit.data.purchase_id='buy';assert.equal(orderStatus(r),'Ordered');
}
});

test('FBA and arbitrary nonempty buy IDs start ordering without overriding exceptions',()=>{for(const purchase_id of ['FBA Order','fba order','Custom Reference']){assert.equal(orderStatus(row('Pending',{}, {purchase_id})),'Ordered');for(const s of ['Alert','OOS','Due Refund'])assert.equal(orderStatus(row(s,{}, {purchase_id})),s);}assert.equal(orderStatus(row('Pending',{}, {purchase_id:'   '})),'Pending');});

test('completed eBay cancellation takes precedence over its refund without changing money',()=>{
 for(const status of ['Pending','Ordered','Shipped','Delivered','Label Created','Due Refund','Cancelled','']){
 const r=row(status,{orderPaymentStatus:'FULLY_REFUNDED',cancelStatus:{cancelState:'CANCELED'}},{buy_price:12,shipping_cost:2,additional_cost:1});r.earnings={value:0};
 const before=JSON.stringify(r);assert.equal(orderStatus(r),'Cancelled');assert.equal(JSON.stringify(r),before);
 }
 for(const cancelState of ['IN_PROGRESS','NONE_REQUESTED','REJECTED'])assert.equal(orderStatus(row('',{orderPaymentStatus:'FULLY_REFUNDED',cancelStatus:{cancelState}})),'Refunded');
});

test('every nonblank buy ID including numeric zero is valid',()=>{
 for(const purchase_id of ['0',0,'1','ABCD','FBA Order','custom reference !'])assert.equal(orderStatus(row('',{}, {purchase_id})),'Ordered');
 for(const purchase_id of ['',null,undefined,'  '])assert.equal(orderStatus(row('',{}, {purchase_id})),'Pending');
});
test('each cost independently activates Ordered, including explicit zero; removed overrides stay removed',()=>{
 for(const [key,legacy] of [['buy_price','product_cost'],['shipping_cost','shipping_cost'],['additional_cost','additional_cost']]){
  for(const value of [0,'0',2.50,'2.50']){
   assert.equal(orderStatus(row('Pending',{}, {[key]:value})),'Ordered');
   assert.equal(orderStatus({workspace_rows:[{data:{[legacy]:value}}]}),'Ordered');
  }
  for(const value of [null,'','  ',true,'invalid',Infinity]){
   assert.equal(orderStatus({edit:{data:{[key]:value}},workspace_rows:[{data:{[legacy]:5}}]}),'Pending');
  }
 }
});
test('unrelated edits never activate Ordered and later status wins over buying inputs',()=>{
 assert.equal(orderStatus(row('Pending',{}, {buyer_account:'Amazon',note:'test',tracking:'123',carrier:'UPS'})),'Pending');
 for(const status of ['Alert','OOS','Due Refund'])assert.equal(orderStatus(row(status,{}, {shipping_cost:0})),status);
 assert.equal(orderStatus(row('',{orderFulfillmentStatus:'FULFILLED'},{shipping_cost:0})),'Shipped');
 assert.equal(orderStatus(row('Refunded',{},{})),'Pending');
});
test('return request alone is not a label; confirmed label precedes outbound delivery',()=>{
 const r=row('',{orderFulfillmentStatus:'FULFILLED'});r.delivery={source:'ebay_get_orders',deliveredAt:'2026-11-20T00:00:00Z'};
 r.returns=[{state:'RETURN_REQUESTED',tracking:{active:true}}];assert.equal(orderStatus(r),'Delivered');
 r.returns[0].tracking.labelDate={value:'2026-11-21T00:00:00Z'};assert.equal(orderStatus(r),'Label Created');
 r.returns[0].tracking.markAsReceived=true;assert.equal(orderStatus(r),'Due Refund');
 r.data.orderPaymentStatus='FULLY_REFUNDED';assert.equal(orderStatus(r),'Refunded');
});
