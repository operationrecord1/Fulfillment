(function(root){'use strict';
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n/100);
const num=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n);

const definitions=[['count','Total Orders','eBay orders · selected period'],['revenue','Gross Revenue','Recorded earnings'],['cost','Product Cost','Recorded purchases'],['gross','Gross Profit','Before expenses & tax'],['net','Net Profit','After expenses & tax'],['tax','Tax','Calculated liability'],['expense','Expense','Recorded expenses'],['avgOrder','Average Order Value','Net eBay earnings per order'],['avgProfit','Average Profit per Order','Gross profit per order'],['margin','Average Profit Margin','Recorded order groups'],['avgDaily','Average Daily Orders','Pacific calendar days · including zero-order days']];
// Aggregate all period orders on the server; only expenses/settings come from Dashboard.
function summarize(data,year,month,metrics){
 if(!metrics||metrics.year!==year||metrics.month!==month)return null;
 const days=metrics.days||[],expenses=(data.expenses||[]).filter(e=>Number(e.date?.slice(0,4))===year&&(!month||Number(e.date.slice(5,7))===month));
 const sum=k=>days.reduce((n,d)=>n+Number(d[k]||0),0),rate=Number(data.options?.tax_percentage??15),taxRate=Number.isFinite(rate)?Math.max(0,rate):15;
 const expense=expenses.reduce((n,e)=>n+root.OrderCore.cents(e.amount),0),gross=sum('gross'),count=sum('count'),revenue=sum('revenue'),marginCount=sum('margin_count');
 const tax=Math.round(Math.max(0,gross-expense)*taxRate/100);
 const a={count,revenue,baseCost:sum('cost'),cost:sum('cost')+sum('shipping')+sum('additional'),shipping:sum('shipping'),additional:sum('additional'),gross,expense,tax,net:gross-expense-tax,margin:marginCount?sum('margin_sum')/marginCount:0,marginCount,avgOrder:count?Math.round(revenue/count):0,avgProfit:count?Math.round(gross/count):0,pendingEarnings:sum('pending_earnings'),pendingCost:sum('pending_cost'),profitCount:sum('profit_count'),sizes:['Small','Medium','Large'].map((name,index)=>{const s=(metrics.sizes||[]).find(x=>x.index===index);return {name,count:Number(s?.count||0),profit:Number(s?.profit||0)};})};
 if(!month)a.taxableAmount=Math.max(0,gross-expense);
 const points=Array.from({length:month?new Date(Date.UTC(year,month,0)).getUTCDate():12},(_,i)=>{
 const selected=days.filter(d=>month?Number(d.metric_date.slice(8,10))===i+1:Number(d.metric_date.slice(5,7))===i+1),profit=selected.reduce((n,d)=>n+Number(d.gross||0),0),orders=selected.reduce((n,d)=>n+Number(d.count||0),0);
 const cost=month?0:expenses.filter(e=>Number(e.date.slice(5,7))===i+1).reduce((n,e)=>n+root.OrderCore.cents(e.amount),0);
 return {index:i,label:month?String(i+1):months[i].slice(0,3),full:month?(i+1)+' '+months[month-1]+' '+year:months[i]+' '+year,value:month?profit:profit-cost-Math.round(Math.max(0,profit-cost)*taxRate/100),count:orders};
 });
 return {a,points,expenses,taxRate};
}

function mount(host,{initial,read,onPeriod,onExpenses}){const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit'}).formatToParts(new Date()),currentYear=Number(today.find(p=>p.type==='year').value);let year=currentYear,month=Number(today.find(p=>p.type==='month').value),disposed=false,request=0,busy=false,signature='',imported=null;const cache=new Map();if(initial)cache.set(initial.year,initial);
 host.dataset.loading='true';host.setAttribute('aria-busy','true');
 host.innerHTML='<div class="orders-overview-head"><div><span>PERFORMANCE OVERVIEW</span><h2>Your month, at a glance.</h2></div><p class="orders-period-caption"></p></div><div class="orders-kpi-scroll" tabindex="0" role="region" aria-label="Order metrics"><div class="overview-kpis om-kpis"><article class="om-period-card om-kpi" data-kpi="period" data-metric="period"></article>'+definitions.map(([k,title,note])=>'<article class="overview-kpi om-kpi" data-kpi="'+k+'" data-metric="'+k+'"><div class="om-kpi-title"><button type="button" class="om-kpi-icon" aria-label="Show '+title+' details" aria-haspopup="dialog" aria-expanded="false">'+root.DashboardKpiIcon(k)+'</button><span>'+title+'</span></div><strong>—</strong><small hidden>'+note+'</small></article>').join('')+'</div></div><div class="orders-chart-scroll" tabindex="0" role="region" aria-label="Order charts"><div class="overview-charts om-charts"><section class="om-panel"><h2>Order Size Distribution</h2><p>Small &lt; $12 · Medium $12–$30 · Large ≥ $30</p><div class="om-chart orders-size-chart"></div><div class="om-performance-legend overview-size-legend"></div></section><section class="om-panel"><h2>Profit &amp; Loss Breakdown</h2><p class="orders-profit-caption"></p><div class="om-chart orders-profit-chart"></div><div class="om-performance-legend overview-profit-legend"></div></section><section class="om-panel overview-trend"><h2>Daily Profit Analysis</h2><p class="overview-trend-caption"></p><div class="om-chart-scroll overview-trend-chart" tabindex="0" aria-label="Profit and loss chart"></div></section></div></div><p class="orders-data-basis">Total orders and size distribution use eBay orders in Pacific time (PST/PDT). Size uses the eBay order total. Average order value uses net eBay order earnings. Average daily orders includes all elapsed Pacific calendar days. Financial cards use saved order earnings and costs; expenses and tax use Dashboard settings.</p><p class="orders-overview-notice" role="status"></p>';
 const $=s=>host.querySelector(s);
 const period=$('[data-metric="period"]');period.replaceChildren();
 const select=document.createElement('select'),yearSelect=document.createElement('select');select.id='orders-month';select.setAttribute('aria-label','Month selection');
 select.innerHTML=months.map((m,i)=>'<option value="'+(i+1)+'">'+m+'</option>').join('')+'<option value="all">Yearly Analytics</option>';
 yearSelect.setAttribute('aria-label','Year');yearSelect.innerHTML=Array.from({length:Math.max(currentYear,year)-2000+1},(_,i)=>Math.max(currentYear,year)-i).map(y=>'<option value="'+y+'">'+y+'</option>').join('');
 select.value=month?String(month):'all';yearSelect.value=String(year);period.append(select);
 select.onchange=()=>{month=select.value==='all'?0:Number(select.value);change();};yearSelect.onchange=()=>{year=Number(yearSelect.value);change();};
 root.mountMonthPicker(select,yearSelect);
 const insights=root.DashboardInsights.bind(host.closest('.om')?.parentElement||host);
 const expenseButton=document.createElement('button');expenseButton.type='button';expenseButton.className='orders-add-expense';expenseButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Add Expense';expenseButton.onclick=async()=>{expenseButton.disabled=true;try{await onExpenses({year,month},refresh);}catch{$('.orders-overview-notice').textContent='Could not open expenses. Please try again.';}finally{expenseButton.disabled=false;}};$('[data-metric=expense]').append(expenseButton);
 let dailyPoints=[],dailyYearly=false,dailyKey='';
 function drawDaily(){const el=$('.overview-trend-chart');if(disposed||!el.clientWidth)return;const width=el.clientWidth,key=JSON.stringify([width,dailyYearly,dailyPoints]);if(key===dailyKey)return;dailyKey=key;const insideAmounts=!dailyYearly&&dailyPoints.some(p=>Math.abs(p.value)>=100000);const layout=root.OrderCharts.profitLayout(dailyPoints,width,{horizontalLoss:dailyYearly,yearly:dailyYearly,compactScroll:root.innerWidth<1400});el.innerHTML=uniqueChart(root.OrderCharts.profitChart(dailyPoints,dailyYearly,width,{layout,insideAmounts,showAmounts:true}).replace(/Gross profit:/g,dailyYearly?'Net profit:':'Gross profit:').replace('Monthly gross profit and loss','Monthly net profit and loss'));el.querySelector('svg').style.minWidth=width+'px';el.dataset.scrollable=String(width>el.clientWidth);}
 function uniqueChart(html){return html.replace(/id="([^"]+)"/g,'id="orders-$1"').replace(/url\(#([^)]*)\)/g,'url(#orders-$1)');}
 function fitTitles(){for(const el of host.querySelectorAll('.om-kpi-title>span')){el.style.fontSize='13px';if(el.scrollWidth>el.clientWidth)el.style.fontSize=Math.max(10,13*el.clientWidth/el.scrollWidth)+'px';}}
 const chartResize=new ResizeObserver(()=>{drawDaily();fitTitles();});chartResize.observe($('.overview-charts'));chartResize.observe($('.overview-kpis'));
 for(const [key,title] of definitions){const card=$('[data-metric="'+key+'"]'),button=card.querySelector('button');button.onclick=()=>{const data=cache.get(year),summary=data&&summarize(data,year,month,imported?.metrics),pairs=items=>'<dl class="om-detail-pairs">'+items.map(([k,v])=>'<div><dt>'+k+'</dt><dd>'+v+'</dd></div>').join('')+'</dl>';let html='<p>Loading selected period…</p>';
 if(summary){const {a,expenses,taxRate}=summary,periodLabel=month?months[month-1]+' '+year:'Report of '+year;
 const items={count:[['Orders',num(a.count)],['Period',periodLabel]],revenue:[['Period',periodLabel],['Recorded Order Earnings',money(a.revenue)],['Orders Awaiting Earnings',num(a.pendingEarnings)]],cost:[['Period',periodLabel],['Buying Price',money(a.baseCost)],['Shipping Cost',money(a.shipping)],['Additional Cost',money(a.additional)],['Total Buying Cost',money(a.cost)],['Orders Awaiting Buying Price',num(a.pendingCost)]],gross:[['Period',periodLabel],['Orders with Earnings and Buying Price',num(a.profitCount)],['Gross Profit',money(a.gross)],['Formula','Earnings − buying price − shipping − additional cost']],margin:[['Orders with Calculated Margin',num(a.marginCount)],['Average Profit Margin',num(a.margin)+'%']],avgDaily:[['Orders',num(a.count)],['Elapsed Calendar Days',num(imported.elapsedDays)],['Average Daily Orders',num(imported.averageDaily)]]};
 html=items[key]?pairs(items[key]):root.DashboardInsights.details(key,a,[],expenses,false,taxRate);
 }insights.open(button,title,card.querySelector('strong').textContent,html);};}

 function syncPicker(){select.value=month?String(month):'all';yearSelect.value=String(year);const trigger=period.querySelector('.om-month-trigger');if(trigger)trigger.textContent=month?months[month-1]+' '+year:'Yearly Analysis of '+year;period.querySelectorAll('[data-value]').forEach(b=>{b.setAttribute('aria-checked',String(b.dataset.value===select.value));if(b.dataset.value==='all')b.textContent='Yearly Analysis of '+year;});}
 function paint(){syncPicker();const data=cache.get(year);const loading=!data||!imported?.metrics||imported.metrics.year!==year||imported.metrics.month!==month;host.dataset.loading=String(loading);host.setAttribute('aria-busy',String(loading));const caption=month?months[month-1]+' '+year:'Report of '+year;$('.orders-period-caption').textContent=caption;paintImported();if(loading){host.querySelectorAll('.overview-kpi:not([data-metric="count"]):not([data-metric="avgDaily"]) strong').forEach(el=>el.textContent='—');for(const selector of ['.orders-size-chart','.orders-profit-chart','.overview-trend-chart'])$(selector).textContent='Loading selected year…';return;}
 const {a,points}=summarize(data,year,month,imported.metrics);const key=JSON.stringify([year,month,a,points,imported]);if(key===signature)return;signature=key;$('.orders-overview-notice').textContent=a.count>a.profitCount?(a.count-a.profitCount)+' orders are awaiting earnings or buying price. Their profit is not included yet.':'';
 for(const [k] of definitions){if(['count','avgDaily'].includes(k))continue;const el=$('[data-metric="'+k+'"] strong');el.textContent=k==='margin'?num(a[k])+'%':k==='count'?num(a[k]):k==='avgDaily'?num(root.DashboardSession.averageDaily(a[k])):money(a[k]);el.classList.toggle('negative',a[k]<0);}
 const distribution=imported?{...a,count:imported.count,sizes:a.sizes.map((g,i)=>({...g,count:imported.sizes[i]||0}))}:null;
 $('.orders-size-chart').innerHTML=distribution?uniqueChart(root.OrderCharts.roundChart(distribution,true)):'Loading eBay order distribution…';
 $('.overview-size-legend').innerHTML=distribution?root.DashboardInsights.progress(distribution,false):'';
 $('.orders-profit-chart').innerHTML=uniqueChart(root.OrderCharts.roundChart(a,false));
 $('.overview-profit-legend').innerHTML=root.DashboardInsights.progress(a,true);
 $('.orders-profit-caption').textContent='Gross Profit: '+money(a.gross);
 $('.orders-profit-caption').classList.toggle('negative',a.gross<0);
 dailyPoints=points;dailyYearly=!month;
 $('.overview-trend h2').textContent=month?'Daily Profit Analysis':'Yearly Profit Analysis';
 $('.overview-trend-caption').textContent=month?'All Calendar Days · '+caption:'January–December '+year+' · Monthly Net Profit';
 drawDaily();fitTitles();
 }
 function paintImported(){
 $('[data-metric="count"] strong').textContent=imported?num(imported.count):'—';
 $('[data-metric="avgDaily"] strong').textContent=imported?num(imported.averageDaily):'—';
 $('[data-metric="avgDaily"] small').textContent=imported?imported.elapsedDays+' Pacific calendar days · includes zero-order days':'Pacific calendar days · includes zero-order days';
 }
 async function refresh(){if(disposed||busy)return;busy=true;const ticket=++request,requestedYear=year;try{const data=await read(requestedYear);if(disposed||ticket!==request)return;cache.set(requestedYear,data);$('.orders-overview-notice').textContent='';paint();}catch{if(!disposed&&ticket===request)$('.orders-overview-notice').textContent='Could not refresh performance. Showing the last available records.';}finally{busy=false;if(!disposed&&requestedYear!==year)refresh();}}
 function change(){insights.close();dailyKey='';imported=null;signature='';paint();onPeriod();refresh();}
 paint();refresh();return {setImported(value){imported=value;paint();},period:()=>({year,month}),refresh,dispose(){disposed=true;request++;chartResize.disconnect();insights.destroy();}};
}
root.OrdersOverview={mount,summarize};if(typeof module!=='undefined')module.exports={summarize};
})(typeof window==='undefined'?globalThis:window);
