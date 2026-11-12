(function(root){
'use strict';
const statusLabel=value=>/^buyer cancel(?:led)?$/i.test(value||'')?'Cancelled':value;
const statuses=['Delivered','Processed','Pending','Refunded','OOS','Alert','Label Created','Cancelled'];
const columns=[['order_id','Order ID'],['quantity','Quantity','number'],['earning','Order Earning','money'],['purchase_id','Purchase ID'],['supplier','Supplier Reference'],['note','Note'],['platform','Platform','select'],['tracking','Tracking'],['secondary_tracking','Secondary Tracking'],['status','Order Status','select'],['product_cost','Product Cost','money'],['shipping_cost','Shipping Cost','money'],['additional_cost','Additional Cost','money'],['gross','Gross Profit','computed'],['margin','Profit Margin','computed'],['id','Unique ID','computed'],['date','Order Date','date']];
const investorFields=new Set(columns.map(c=>c[0]).filter(k=>!['purchase_id','platform'].includes(k)));
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
  const connected=prev&&r.year===prev.year&&r.month===prev.month&&(r.position===undefined||prev.position===undefined||(r.sourcePosition??r.position)===(prev.sourcePosition??prev.position)+1)&&(investor?r.group_key===prev.group_key:((a.order_id&&a.order_id===b.order_id)||(a.purchase_id&&a.purchase_id===b.purchase_id)));
  if(!connected)out.push({rows:[],revenue:0,cost:0,other:0,hasRevenue:false,hasCost:false});
  const g=out[out.length-1];g.rows.push(r);g.revenue+=cents(a.earning);g.cost+=cents(a.product_cost);g.other+=cents(a.shipping_cost)+cents(a.additional_cost);g.hasRevenue||=present(a.earning);g.hasCost||=present(a.product_cost);prev=r;
 }
 for(const g of out){g.profit=investor?(present(g.rows[0].group_profit)?cents(g.rows[0].group_profit):null):(g.hasRevenue&&g.hasCost?g.revenue-g.cost-g.other:null);g.margin=g.revenue&&g.profit!==null?Math.max(-100,Math.min(100,g.profit/g.revenue*100)):null;}
 return out;
}
function aggregate(rows,expenses,investor=false,taxPercentage=15){
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
 const expense=expenses.reduce((s,e)=>s+cents(e.amount),0),tax=Math.round(Math.max(0,gross-expense)*(Number.isFinite(Number(taxPercentage))?Math.max(0,Number(taxPercentage)):15)/100),count=orders.size;
 return {groups:gs,count,revenue,cost,gross,expense,tax,net:gross-expense-tax,margin:margins.length?margins.reduce((a,b)=>a+b,0)/margins.length:0,avgOrder:count?Math.round(revenue/count):0,avgProfit:count?Math.round(gross/count):0,avgDaily:daily.size?count/daily.size:0,sizes,points:[...daily].sort(([a],[b])=>a.localeCompare(b))};
}
// Annual tax is the sum of monthly liabilities; a loss month cannot undo another month's tax.
function aggregateYear(rows,expenses,investor=false,taxPercentage=15){
 const periods=new Map(),period=(year,month)=>String(year||'')+'-'+String(month).padStart(2,'0');
 const bucket=key=>{if(!periods.has(key))periods.set(key,{rows:[],expenses:[]});return periods.get(key);};
 for(const row of rows)bucket(period(row.year??row.data.date?.slice(0,4),row.month??row.data.date?.slice(5,7))).rows.push(row);
 for(const expense of expenses)bucket(expense.date?.slice(0,7)||'').expenses.push(expense);
 const ordered=[...periods.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,value])=>value);
 const result=aggregate(ordered.flatMap(p=>p.rows),expenses,investor,taxPercentage);
 const monthly=ordered.map(p=>aggregate(p.rows,p.expenses,investor,taxPercentage));
 for(const key of ['gross','expense','tax','net'])result[key]=monthly.reduce((sum,a)=>sum+a[key],0);
 result.taxableAmount=monthly.reduce((sum,a)=>sum+Math.max(0,a.gross-a.expense),0);
 return result;
}
function duplicates(rows,fields=['order_id','purchase_id']){const marks=new Set();for(const key of fields){const runs=new Map();let prev='',month=null,position=null;for(const r of rows){const value=r.data[key]||'';if(value){if(!runs.has(value))runs.set(value,[]);if(value!==prev||month!==r.month||(r.position!==undefined&&position!==null&&r.position!==position+1))runs.get(value).push([]);runs.get(value).at(-1).push(r);}prev=value;month=r.month;position=r.position??null;}for(const run of runs.values())if(run.length>1)run.flat().forEach(r=>marks.add(r.id||r._key));}return marks;}
const statusPaths={
    delivered:'<path d="m3 7 7-4 7 4-7 4-7-4Z"/><path d="M3 7v9l7 4V11m7-4v5M6.5 5l7 4"/><path d="m14 17 2 2 5-5"/>',
    pending:'<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    refunded:'<path d="m8 5-5 5 5 5M3 10h11a6 6 0 0 1 0 12"/><path d="M14 16h4"/>',
    oos:'<path d="m3 7 7-4 7 4-7 4-7-4ZM3 7v9l7 4 7-4V7M10 11v9M6.5 5l7 4M3 21 21 3"/>',
    alert:'<path d="m10.3 4.9-7.5 13A2 2 0 0 0 4.5 21h15a2 2 0 0 0 1.7-3.1l-7.5-13a2 2 0 0 0-3.4 0Z"/><path d="M12 9v5M12 17h.01"/>',
    label:'<path d="M20 13 11 22 2 13V3h10l8 8a1.4 1.4 0 0 1 0 2Z" transform="translate(1 -1) scale(.95)"/><circle cx="7" cy="7" r="1.2"/>',
    processed:'<path d="m9 3-.7 2.2-2.1 1L4 6l-1 3 1.6 1.6v2.5L3 15l1.5 2.6 2.2-.4 2.1 1 .7 2.2h3l.7-2.2 2.1-1 2.2.4L19 15l-1.6-1.9v-2.5L19 9l-1-3-2.2.2-2.1-1L13 3Z"/><path d="m8 12 2 2 4-4"/>',
    cancelled:'<circle cx="12" cy="12" r="8"/><path d="m9 9 6 6m0-6-6 6"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    chevron:'<path d="m7 10 5 5 5-5"/>',
    clear:'<path d="m4 13 9-9a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 8H8l-4-4a2 2 0 0 1 0-3Z"/><path d="m9 8 9 9M13 20h9"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    bookmark:'<path d="M6 4h12v17l-6-4-6 4V4Z"/>'
  };
const statusIcon=value=>{const key=({'Label Created':'label','Clear Selection':'clear'})[value]||String(value).toLowerCase();return statusPaths[key]?'<svg class="status-symbol" viewBox="0 0 24 24" aria-hidden="true">'+statusPaths[key]+'</svg>':'';};
const statusOrder=values=>[...values].sort((a,b)=>(statuses.indexOf(a)<0?99:statuses.indexOf(a))-(statuses.indexOf(b)<0?99:statuses.indexOf(b)));
const api={statusIcon,statusOrder,statusLabel,statuses,columns,investorFields,present,cents,link,groups,aggregate,aggregateYear,duplicates};root.OrderCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
