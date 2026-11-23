import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deliveryRecords,readDelivery} from './supabase/functions/ebay-sync/delivery.mjs';
import P from './ebay-presentation.js';
const id='20-15421-96043';
const response=items=>({GetOrdersResponse:{Ack:'Success',OrderArray:{Order:{OrderID:id,TransactionArray:{Transaction:items}}}}});
test('first actual delivery makes whole order delivered even other packages are outstanding',()=>{
 const r=deliveryRecords(response([{ShippingDetails:{ShippingPackageInfo:{ActualDeliveryTime:'2026-11-18T06:45:00Z'}}},{ShippingDetails:{ShipmentTrackingNumber:'other'}}]),[id])[0];
 assert.equal(P.orderStatus({data:{},delivery:r.data}),'Delivered');
});
test('estimates and tracking alone never claim delivery',()=>{
 const r=deliveryRecords(response([{ShippingDetails:{ShipmentTrackingNumber:'tracking',EstimatedDeliveryTime:'2026-11-18T06:45:00Z'}}]),[id])[0];
 assert.equal(r.data.deliveredAt,null);assert.equal(P.orderStatus({delivery:r.data}),'Shipped');
});
test('manual exceptions beat outbound delivery; clearing resumes',()=>{
 for(const status of ['Alert','OOS','Refunded','Due Refund']){
 const row={delivery:{source:'ebay_get_orders',deliveredAt:'2026-11-18T06:45:00Z'},edit:{data:{status}}};
 assert.equal(P.orderStatus(row),status);row.edit.data.status='';assert.equal(P.orderStatus(row),'Delivered');
 }
});
test('failed, wrong-order and incomplete replies fail instead of publishing unknown delivery',async()=>{
 assert.throws(()=>deliveryRecords({GetOrdersResponse:{Ack:'Failure'}},[id]));
 assert.throws(()=>deliveryRecords(response([]),['other']));
 await assert.rejects(readDelivery({delivery_ids:[id]},'token',async()=>new Response('xml'),()=>({GetOrdersResponse:{Ack:'Success'}})),/Incomplete/);
});
test('return label takes priority over an earlier outbound delivery',()=>{
 assert.equal(P.orderStatus({delivery:{source:'ebay_get_orders',deliveredAt:'2026-11-18T06:45:00Z'},returns:[{state:'ITEM_SHIPPED',tracking:{active:true,labelDate:{value:'2026-11-20T00:00:00Z'}}}]}),'Label Created');
});
