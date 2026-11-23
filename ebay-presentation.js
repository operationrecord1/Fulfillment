(function(root){'use strict';
const present=x=>x!==null&&x!==undefined&&x!=='';
const number=x=>present(x)&&typeof x!=='boolean'&&Number.isFinite(Number(x))?Number(x):null;
const url=x=>{try{const u=new URL(x);return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return '';}};
const values=(rows,key)=>[...new Set(rows.map(r=>r.data?.[key]).filter(present).map(String))];
const sum=(rows,key)=>{const ns=rows.map(r=>number(r.data?.[key])).filter(x=>x!==null);return ns.length?ns.reduce((a,b)=>a+b,0):null;};
// Manual exception statuses pause automation. Never infer delivery from FULFILLED.
function orderStatus(row){
 const edit=row.edit?.data||{},records=row.workspace_rows||[],d=row.data||{};
 const manual=Object.hasOwn(edit,'status')?edit.status:values(records,'status')[0];
 if(['Alert','OOS','Refunded','Due Refund'].includes(manual))return manual;
 if(d.cancelStatus?.cancelState==='CANCELED')return 'Cancelled';
 // Retain manually confirmed delivery/return stages until a verified later event exists.
 if(['Delivered','Cancelled','Label Created'].includes(manual))return manual;
 if(d.orderFulfillmentStatus==='FULFILLED')return 'Shipped';
 const purchase=Object.hasOwn(edit,'purchase_id')?edit.purchase_id:values(records,'purchase_id').join('');
 if(String(purchase||'').trim()&&(!manual||manual==='Pending'))return 'Ordered';
 return manual==='Processed'?'Ordered':manual||'Pending';
}
function order(row){const d=row.data||{},records=row.workspace_rows||[],items=d.lineItems||[],earning=number(row.earnings?.value),cost=Object.hasOwn(row.edit?.data||{},'buy_price')?number(row.edit.data.buy_price):sum(records,'product_cost'),shipping=sum(records,'shipping_cost'),extra=sum(records,'additional_cost');const gross=earning!==null&&cost!==null&&(row.earnings?.currency||'USD')==='USD'?Math.round((earning-cost-(shipping??0)-(extra??0))*100)/100:null;
return {records,items,quantity:items.reduce((n,x)=>n+(number(x.quantity)??0),0),earning,earningSource:earning!==null?'eBay net order earnings after order-linked fees, credits and refunds':'Waiting for eBay earnings',currency:row.earnings?.currency||'USD',cost,shipping,extra,gross,margin:gross!==null&&earning?Math.max(-100,Math.min(100,gross/earning*100)):null,purchase:Object.hasOwn(row.edit?.data||{},'purchase_id')?[row.edit.data.purchase_id].filter(Boolean):values(records,'purchase_id'),supplier:values(records,'supplier'),platform:values(records,'platform'),tracking:Object.hasOwn(row.edit?.data||{},'tracking')?[row.edit.data.tracking].filter(Boolean):values(records,'tracking'),secondary:values(records,'secondary_tracking'),note:Object.hasOwn(row.edit?.data||{},'note')?[row.edit.data.note].filter(Boolean):values(records,'note'),status:d.cancelStatus?.cancelState==='CANCELED'?'CANCELLED':d.orderFulfillmentStatus,localStatus:Object.hasOwn(row.edit?.data||{},'status')?[row.edit.data.status].filter(Boolean):values(records,'status'),unique:records.map(r=>r.display_number).filter(present).map(n=>'FL-'+String(n).padStart(8,'0').replace(/(.{4})(.{4})/,'$1-$2')),date:d.creationDate};}
function amazonAsin(value){const raw=String(value||'').trim();if(/^[A-Za-z0-9]{10}$/.test(raw))return raw.toUpperCase();try{const u=new URL(raw);if(!['https:','http:'].includes(u.protocol)||!['amazon.com','www.amazon.com','smile.amazon.com'].includes(u.hostname))return null;const m=u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Za-z0-9]{10})(?:\/|$)/);return m?m[1].toUpperCase():null;}catch{return null;}}
const api={order,url,number,amazonAsin,orderStatus};root.EbayPresentation=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
