export class TrackingError extends Error {
 constructor(message,status=0,uncertain=false){super(message);this.status=status;this.uncertain=uncertain;}
}
const endpoint=id=>'https://api.ebay.com/sell/fulfillment/v1/order/'+encodeURIComponent(id);
async function read(url,token,fetcher){
 const r=await fetcher(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
 const d=await r.json().catch(()=>null);
 if(!r.ok||d?.errors?.length)throw new TrackingError('eBay '+r.status+': '+(d?.errors?.map(x=>x.message).join('; ')||'Tracking check failed'),r.status);
 if(!d||typeof d!=='object')throw new TrackingError('Invalid eBay response');return d;
}
export async function inspectOrder(id,token,fetcher=fetch){
 const order=await read(endpoint(id),token,fetcher);
 if(order.orderId!==id||!Array.isArray(order.lineItems)||!order.lineItems.length)throw new TrackingError('Order identity could not be verified');
 const d=await read(endpoint(id)+'/shipping_fulfillment',token,fetcher);
 if(!Array.isArray(d.fulfillments))throw new TrackingError('Invalid eBay fulfillment response; submission blocked');
 const shipments=d.fulfillments.map(x=>({id:x.fulfillmentId||'',tracking:x.shipmentTrackingNumber||'',carrier:x.shippingCarrierCode||'',shippedDate:x.shippedDate||null}));
 let reason='';
 if(shipments.some(x=>String(x.tracking).trim()))reason='Tracking already exists on eBay. Adding or replacing tracking is blocked.';
 else if(['CANCELED','CANCELLED'].includes(order.cancelStatus?.cancelState))reason='This order is cancelled. Tracking cannot be added.';
 return {order,shipments,blocked:!!reason,reason,checked_at:new Date().toISOString()};
}
export function validateTracking(tracking,carrier){
 if(typeof tracking!=='string'||!tracking.trim()||tracking.trim().length>100||/[\s,;\x00-\x1f]/.test(tracking.trim()))throw new TrackingError('Enter one tracking number without spaces or separators');
 if(typeof carrier!=='string'||!carrier.trim()||carrier.trim().length>100||/[\x00-\x1f]/.test(carrier))throw new TrackingError('Enter or choose a carrier');
 return {tracking:tracking.trim(),carrier:carrier.trim()};
}
export async function publishTracking(id,order,tracking,carrier,token,fetcher=fetch){
 const value=validateTracking(tracking,carrier);
 const body={trackingNumber:value.tracking,shippingCarrierCode:value.carrier,lineItems:order.lineItems.map(x=>({lineItemId:x.lineItemId,quantity:x.quantity}))};
 let r;try{r=await fetcher(endpoint(id)+'/shipping_fulfillment',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});}catch{throw new TrackingError('Submission outcome is unknown. Check eBay status before taking further action.',0,true);}
 if(r.status!==201){const d=await r.json().catch(()=>null);throw new TrackingError('eBay '+r.status+': '+(d?.errors?.map(x=>x.message).join('; ')||'Tracking submission was not confirmed'),r.status,r.status>=500||r.status===408||r.status===429||r.ok);}
 return {accepted:true};
}
