(function(root){'use strict';
const present=x=>x!==null&&x!==undefined&&x!=='';
const number=x=>present(x)&&typeof x!=='boolean'&&Number.isFinite(Number(x))?Number(x):null;
const url=x=>{try{const u=new URL(x);return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return '';}};
const values=(rows,key)=>[...new Set(rows.map(r=>r.data?.[key]).filter(present).map(String))];
const sum=(rows,key)=>{const ns=rows.map(r=>number(r.data?.[key])).filter(x=>x!==null);return ns.length?ns.reduce((a,b)=>a+b,0):null;};
function order(row){const d=row.data||{},records=row.workspace_rows||[],items=d.lineItems||[],earning=sum(records,'earning'),cost=sum(records,'product_cost'),shipping=sum(records,'shipping_cost'),extra=sum(records,'additional_cost');const gross=earning!==null&&cost!==null?Math.round((earning-cost-(shipping??0)-(extra??0))*100)/100:null;
return {records,items,quantity:items.reduce((n,x)=>n+(number(x.quantity)??0),0),earning:earning??number(d.pricingSummary?.total?.value),earningSource:earning!==null?'Recorded Dashboard earning':'eBay order total; includes amounts charged to buyer, not net payout',currency:earning!==null?'USD':d.pricingSummary?.total?.currency||'USD',cost,shipping,extra,gross,margin:gross!==null&&earning?Math.max(-100,Math.min(100,gross/earning*100)):null,purchase:values(records,'purchase_id'),supplier:values(records,'supplier'),platform:values(records,'platform'),tracking:values(records,'tracking'),secondary:values(records,'secondary_tracking'),note:values(records,'note'),status:d.cancelStatus?.cancelState==='CANCELED'?'CANCELLED':d.orderFulfillmentStatus,localStatus:values(records,'status'),unique:records.map(r=>r.display_number).filter(present).map(n=>'FL-'+String(n).padStart(8,'0').replace(/(.{4})(.{4})/,'$1-$2')),date:d.creationDate};}
const api={order,url,number};root.EbayPresentation=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
