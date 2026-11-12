(function(root){
'use strict';
const C=root.OrderCore||(typeof require==='function'?require('./dashboard-core'):null);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
const pct=n=>(Number.isFinite(n)?n:0).toFixed(1)+'%';
function shares(a,profit){const total=profit?a.sizes.reduce((s,x)=>s+Math.max(0,x.profit),0):a.count;return a.sizes.map(x=>({...x,percent:total?(profit?Math.max(0,x.profit):x.count)/total*100:0}));}
function progress(a,profit){if(!a.count)return '<div class="om-progress-empty">No orders this period</div>';return '<div class="om-progress-list">'+shares(a,profit).map(x=>'<div class="om-progress-row" tabindex="0" title="'+esc(profit?'Percentage of positive category profit; losses contribute 0%':'Share of unique orders')+'"><span>'+x.name+'</span><b class="'+(x.profit<0&&profit?'negative':'')+'">'+(profit?money(x.profit):x.count)+'</b><div class="om-progress-track" role="progressbar" aria-label="'+x.name+(profit?' positive profit contribution':' order share')+'" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+x.percent.toFixed(2)+'"><i style="width:'+x.percent+'%"></i></div><span class="om-progress-percent">'+pct(x.percent)+'</span></div>').join('')+'</div>';}
function statusBreakdown(rows,investor=false){
 const orders=new Map(),extra={status:'Unassigned',count:0,revenue:0,cost:0,profit:0};
 for(const r of rows){const d=r.data;if(!d.order_id){extra.revenue+=C.cents(d.earning);extra.cost+=C.cents(d.product_cost);continue;}const o=orders.get(d.order_id)||{status:'Not set',revenue:0,cost:0,profit:0};if(d.status)o.status=d.status;o.revenue+=C.cents(d.earning);o.cost+=C.cents(d.product_cost);orders.set(d.order_id,o);}
 for(const g of C.groups(rows,investor)){if(g.profit===null)continue;const first=g.rows.find(r=>r.data.order_id);if(!first){extra.profit+=g.profit;continue;}let allocated=0;for(const r of g.rows){const d=r.data,value=C.cents(d.earning)-C.cents(d.product_cost)-C.cents(d.shipping_cost)-C.cents(d.additional_cost);orders.get(d.order_id||first.data.order_id).profit+=value;allocated+=value;}orders.get(first.data.order_id).profit+=g.profit-allocated;}
 const grouped=new Map();for(const o of orders.values()){const item=grouped.get(o.status)||{status:o.status,count:0,revenue:0,cost:0,profit:0};item.count++;for(const key of ['revenue','cost','profit'])item[key]+=o[key];grouped.set(o.status,item);}
 if(extra.revenue||extra.cost||extra.profit)grouped.set('Unassigned',extra);
 return [...grouped.values()].map(x=>({...x,margin:x.revenue?Math.max(-100,Math.min(100,x.profit/x.revenue*100)):0}));
}
function currency(n){return '<span class="om-detail-money '+(n<0?'negative':'')+'"><span>'+(n<0?'-':'')+'</span><span>$</span><span>'+new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Math.abs(n)/100)+'</span></span>';}
function details(key,a,rows,expenses,investor,tax){
 const statuses=statusBreakdown(rows,investor);
 const pairs=items=>'<dl class="om-detail-pairs">'+items.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+value+'</dd></div>').join('')+'</dl>';
 if(key==='count'&&!a.count)return '<p>No orders this period</p>';
 if(key==='count')return '<table class="om-status-details"><thead><tr><th>Order Status</th><th>Orders</th><th>Profit</th><th>Margin</th></tr></thead><tbody>'+statuses.map(s=>'<tr><th>'+esc(s.status)+'</th><td>'+s.count+'</td><td>'+currency(s.profit)+'</td><td class="'+(s.margin<0?'negative':'')+'">'+pct(s.margin)+'</td></tr>').join('')+'</tbody></table>';
 if(key==='net')return pairs([['Gross Profit',currency(a.gross)],['Expense',currency(a.expense)],['Tax',currency(a.tax)],['Net Profit',currency(a.net)]]);
 if(key==='expense'){const types=new Map();for(const e of expenses)types.set(e.type||'Other',(types.get(e.type||'Other')||0)+C.cents(e.amount));return pairs([...types].map(([k,v])=>[k,currency(v)]).concat([['Total Expense',currency(a.expense)]]));}
 if(['revenue','cost','gross'].includes(key))return pairs(statuses.map(s=>[s.status,currency(s[key==='gross'?'profit':key])]));
 if(key==='tax')return pairs([['Gross Profit',currency(a.gross)],['Expense',currency(a.expense)],['Taxable amount',currency(Math.max(0,a.gross-a.expense))],['Tax rate',pct(tax)],['Tax',currency(a.tax)]]);
 if(key==='avgOrder')return pairs([['Gross Revenue',currency(a.revenue)],['Unique orders',a.count],['Average Order Value',currency(a.avgOrder)]]);
 if(key==='avgProfit')return pairs([['Gross Profit',currency(a.gross)],['Unique orders',a.count],['Average Profit per Order',currency(a.avgProfit)]]);
 if(key==='avgDaily')return pairs([['Unique orders',a.count],['Dates with orders',a.points.length],['Unrounded daily average',a.avgDaily.toFixed(2)]]);
 return pairs([['Calculated order groups',a.groups.filter(g=>g.margin!==null).length],['Average group profit margin',pct(a.margin)]]);
}
function bind(host){
 const pop=document.createElement('div');pop.className='om-kpi-details';pop.setAttribute('popover','auto');pop.setAttribute('role','dialog');pop.setAttribute('aria-label','Metric details');host.append(pop);let anchor=null;
 const close=()=>{if(pop.matches(':popover-open'))pop.hidePopover();};
 const position=()=>{if(!anchor||!pop.matches(':popover-open'))return;if(window.innerWidth<600){Object.assign(pop.style,{left:'0px',top:'0px'});return;}const r=anchor.closest('.om-kpi').getBoundingClientRect();pop.style.left=Math.max(8,Math.min(r.left,window.innerWidth-pop.offsetWidth-8))+'px';pop.style.top=Math.max(8,Math.min(r.top,window.innerHeight-pop.offsetHeight-8))+'px';};
 pop.addEventListener('beforetoggle',e=>{if(e.newState==='closed'){anchor?.setAttribute('aria-expanded','false');anchor=null;}});
 const open=(button,title,value,html)=>{if(anchor===button&&pop.matches(':popover-open')){close();return;}close();anchor=button;pop.innerHTML='<div class="om-details-heading"><div><h3>'+esc(title)+'</h3><strong>'+esc(value)+'</strong></div><button type="button" aria-label="Close details">×</button></div>'+html;pop.setAttribute('aria-label',title+' details');pop.querySelector('button').onclick=()=>{const old=anchor;close();old?.focus({preventScroll:true});};button.setAttribute('aria-expanded','true');pop.showPopover();position();pop.querySelector('button').focus({preventScroll:true});};
 const scroll=e=>{if(!pop.contains(e.target))close();};window.addEventListener('resize',position);host.addEventListener('scroll',scroll,true);
 return {open,close,destroy(){close();window.removeEventListener('resize',position);host.removeEventListener('scroll',scroll,true);pop.remove();}};
}
const api={shares,progress,statusBreakdown,details,bind};root.DashboardInsights=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
