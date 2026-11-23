const list=x=>x==null?[]:Array.isArray(x)?x:[x];
function values(node,key){
 if(!node||typeof node!=='object')return [];
 return Object.entries(node).flatMap(([k,v])=>k===key?list(v):values(v,key));
}
export function deliveryRecords(parsed,ids,now=Date.now()){
 const response=parsed?.GetOrdersResponse;
 if(!['Success','Warning'].includes(response?.Ack))throw Error('eBay delivery response unsuccessful');
 const orders=list(response.OrderArray?.Order),allowed=new Set(ids);
 if(orders.some(o=>!allowed.has(String(o.OrderID))))throw Error('Unexpected delivery order ID');
 return orders.map(o=>{
  const delivered=values(o,'ActualDeliveryTime').filter(x=>typeof x==='string'&&Number.isFinite(Date.parse(x))).sort();
  return {id:String(o.OrderID),data:{source:'ebay_get_orders',deliveredAt:delivered[0]||null,hasTracking:values(o,'ShipmentTrackingNumber').some(x=>typeof x==='string'&&x.trim()),observedAt:new Date(now).toISOString()}};
 });
}
export async function readDelivery(job,token,fetcher,parseXML,now=Date.now()){
 const ids=job.delivery_ids||[];
 if(ids.some(x=>!/^\d{2}-\d{5}-\d{5}$/.test(x)))throw Error('Invalid delivery order ID');
 if(!ids.length)return {records:[],cursor:{},done:true,watermark:new Date(now).toISOString()};
 const response=await fetcher('https://api.ebay.com/ws/api.dll',{method:'POST',headers:{'Content-Type':'text/xml','X-EBAY-API-IAF-TOKEN':token,'X-EBAY-API-CALL-NAME':'GetOrders','X-EBAY-API-SITEID':'0','X-EBAY-API-COMPATIBILITY-LEVEL':'1231'},body:'<?xml version="1.0" encoding="utf-8"?><GetOrdersRequest xmlns="urn:ebay:apis:eBLBaseComponents"><OrderIDArray>'+ids.map(id=>'<OrderID>'+id+'</OrderID>').join('')+'</OrderIDArray><DetailLevel>ReturnAll</DetailLevel></GetOrdersRequest>',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('eBay delivery HTTP '+response.status);
 const records=deliveryRecords(parseXML(await response.text()),ids,now);
 // Missing requested records are not silently acknowledged.
 if(new Set(records.map(r=>r.id)).size!==ids.length)throw Error('Incomplete eBay delivery response');
 return {records,cursor:ids.length===50?{after:ids.at(-1)}:{},done:ids.length<50,watermark:new Date(now).toISOString()};
}
