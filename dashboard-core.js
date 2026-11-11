(function(root){
'use strict';
const statuses=['Pending','Processed','Delivered','Label Created','Buyer Cancelled','Refunded','OOS','Alert'];
const columns=[['order_id','Order ID'],['quantity','Quantity','number'],['earning','Order Earning','money'],['purchase_id','Purchase ID'],['supplier','Supplier Reference'],['note','Note'],['platform','Platform','select'],['tracking','Tracking'],['secondary_tracking','Secondary Tracking'],['status','Order Status','select'],['product_cost','Product Cost','money'],['shipping_cost','Shipping Cost','money'],['additional_cost','Additional Cost','money'],['gross','Gross Profit','computed'],['margin','Profit Margin','computed'],['id','Order Unique ID','computed'],['date','Order Date','date']];
const investorFields=new Set(['order_id','quantity','earning','status','product_cost','shipping_cost','additional_cost','gross','margin','date']);
const present=v=>v!==''&&v!==null&&v!==undefined;
const cents=v=>Math.round(Number(v||0)*100);
function link(value,kind){
 let url;try{url=new URL(value);}catch{return {text:value,url:''};}
 if(!['https:','http:'].includes(url.protocol))return {text:value,url:''};
 const host=url.hostname.replace(/^www\./,'');let id='';
 if(kind==='order_id'&&/^(?:[a-z0-9-]+\.)?ebay\.(com|co\.uk|ca|com\.au|de)$/.test(host))id=url.searchParams.get('orderid')||url.searchParams.get('order_id')||'';
 if(kind==='purchase_id'&&/^(?:[a-z0-9-]+\.)?amazon\.(com|co\.uk|ca|de|fr|it|es|com\.au|co\.jp|in)$/.test(host))id=url.searchParams.get('orderID')||url.searchParams.get('orderId')||url.searchParams.get('order-id')||'';
 return {text:id||value,url:url.href};
}
function groups(rows,investor=false){
 const out=[];let prev=null;
 for(const r of rows){const a=r.data,b=prev?.data;
  const connected=prev&&r.month===prev.month&&(r.position===undefined||prev.position===undefined||(r.sourcePosition??r.position)===(prev.sourcePosition??prev.position)+1)&&(investor?r.group_key===prev.group_key:((a.order_id&&a.order_id===b.order_id)||(a.purchase_id&&a.purchase_id===b.purchase_id)));
  if(!connected)out.push({rows:[],revenue:0,cost:0,other:0,hasRevenue:false,hasCost:false});
  const g=out[out.length-1];g.rows.push(r);g.revenue+=cents(a.earning);g.cost+=cents(a.product_cost);g.other+=cents(a.shipping_cost)+cents(a.additional_cost);g.hasRevenue||=present(a.earning);g.hasCost||=present(a.product_cost);prev=r;
 }
 for(const g of out){g.profit=investor?(present(g.rows[0].group_profit)?cents(g.rows[0].group_profit):null):(g.hasRevenue&&g.hasCost?g.revenue-g.cost-g.other:null);g.margin=g.revenue&&g.profit!==null?Math.max(-100,Math.min(100,g.profit/g.revenue*100)):null;}
 return out;
}
function aggregate(rows,expenses,investor=false){
 const gs=groups(rows,investor),orders=new Map(),daily=new Map(),margins=[];
 let revenue=0,cost=0,gross=0;
 for(const r of rows){const d=r.data;revenue+=cents(d.earning);cost+=cents(d.product_cost);if(d.order_id){const o=orders.get(d.order_id)||{revenue:0,profit:0};o.revenue+=cents(d.earning);orders.set(d.order_id,o);}if(d.date&&d.order_id&&!daily.has(d.date))daily.set(d.date,0);}
 for(const g of gs){if(g.profit===null)continue;gross+=g.profit;if(g.margin!==null)margins.push(g.margin);const first=g.rows.find(r=>r.data.order_id);if(first){
 // Attribute each row's existing earning-minus-cost contribution to its order.
 // A shared purchase group must not move every order's profit into its first category.
 let allocated=0;
 for(const r of g.rows){const d=r.data,key=d.order_id||first.data.order_id,value=cents(d.earning)-cents(d.product_cost)-cents(d.shipping_cost)-cents(d.additional_cost);orders.get(key).profit+=value;allocated+=value;}
 orders.get(first.data.order_id).profit+=g.profit-allocated;
 }const dated=g.rows.find(r=>r.data.date);if(dated)daily.set(dated.data.date,(daily.get(dated.data.date)||0)+g.profit);}
 const sizes=[{name:'Small',count:0,profit:0},{name:'Medium',count:0,profit:0},{name:'Large',count:0,profit:0}];
 for(const o of orders.values()){const s=sizes[o.revenue<1200?0:o.revenue<3000?1:2];s.count++;s.profit+=o.profit;}
 const expense=expenses.reduce((s,e)=>s+cents(e.amount),0),tax=Math.round(Math.max(0,gross-expense)*.15),count=orders.size;
 return {groups:gs,count,revenue,cost,gross,expense,tax,net:gross-expense-tax,margin:margins.length?margins.reduce((a,b)=>a+b,0)/margins.length:0,avgOrder:count?Math.round(revenue/count):0,avgProfit:count?Math.round(gross/count):0,avgDaily:daily.size?Math.round(count/daily.size):0,sizes,points:[...daily].sort(([a],[b])=>a.localeCompare(b))};
}
function duplicates(rows,fields=['order_id','purchase_id']){const marks=new Set();for(const key of fields){const runs=new Map();let prev='',month=null,position=null;for(const r of rows){const value=r.data[key]||'';if(value){if(!runs.has(value))runs.set(value,[]);if(value!==prev||month!==r.month||(r.position!==undefined&&position!==null&&r.position!==position+1))runs.get(value).push([]);runs.get(value).at(-1).push(r);}prev=value;month=r.month;position=r.position??null;}for(const run of runs.values())if(run.length>1)run.flat().forEach(r=>marks.add(r.id||r._key));}return marks;}
const api={statuses,columns,investorFields,present,cents,link,groups,aggregate,duplicates};root.OrderCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
