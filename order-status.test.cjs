const {test}=require('node:test');
const assert=require('node:assert/strict');
const {orderStatus}=require('./ebay-presentation.js');
const row=(status,data={},extra={})=>({data,edit:{data:{status,...extra}}});
test('buy ID advances pending, price alone does not',()=>{
 assert.equal(orderStatus(row('Pending',{}, {purchase_id:'114-1234567-1234567'})),'Ordered');
 assert.equal(orderStatus(row('Pending',{}, {buy_price:3})),'Pending');
});
test('all four manual exceptions block every imported event',()=>{
 for(const status of ['Alert','OOS','Refunded','Due Refund'])for(const data of [{orderFulfillmentStatus:'FULFILLED'},{cancelStatus:{cancelState:'CANCELED'}}])
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
test('existing delivery and return stages do not regress on old outbound shipment data',()=>{
 for(const s of ['Delivered','Label Created'])assert.equal(orderStatus(row(s,{orderFulfillmentStatus:'FULFILLED'})),s);
});
