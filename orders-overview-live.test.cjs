const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('./orders-overview.js'),'utf8');

function fixture(month=11){
 class Element{
  constructor(){this.children=new Map();this.dataset={};this.style={};this.attributes={};this.textContent='';this.clientWidth=0;this.hidden=true;this.classList={toggle(){}};}
  querySelector(selector){if(!this.children.has(selector))this.children.set(selector,new Element());return this.children.get(selector);}
  querySelectorAll(){return [];}
  setAttribute(name,value){this.attributes[name]=String(value);}
  append(){}
  closest(){return null;}
  matches(){return false;}
  addEventListener(){}
  removeEventListener(){}
  focus(){}
 }
 const host=new Element(),cards=new Map(),select=host.querySelector.bind(host);
 host.querySelector=selector=>{
  const match=selector.match(/^\[data-metric="?([a-zA-Z]+)"?\](?: (strong|small))?$/);
  if(!match)return select(selector);
  if(!cards.has(match[1]))cards.set(match[1],new Element());
  const card=cards.get(match[1]);return match[2]?card.querySelector(match[2]):card;
 };
 host.querySelectorAll=selector=>selector.startsWith('.overview-kpi:not(')?[...cards].filter(([key])=>!['count','avgDaily','period'].includes(key)).map(([,card])=>card.querySelector('strong')):[];
 const popup={openCalls:0,updateCalls:0,closeCalls:0,active:null};
 const insights={
  open(button,title,value,html,options){popup.openCalls++;Object.assign(popup,{active:button,title,value,html,options});},
  update(button,title,value,html,options){if(popup.active!==button)return false;popup.updateCalls++;Object.assign(popup,{title,value,html,options});return true;},
  close(){popup.closeCalls++;popup.active=null;},destroy(){}
 };
 const initial={year:2026,expenses:[],options:{tax_percentage:15}};
 const win={
  innerWidth:1200,innerHeight:900,OrderCore:require('./dashboard-core.js'),DashboardKpiIcon:()=>'',
  DashboardInsights:{bind:()=>insights,progress:()=>'',details:()=>''},OrderCharts:{roundChart:()=>''},
  localStorage:{getItem:()=>JSON.stringify({year:2026,month}),setItem(){}},addEventListener(){},removeEventListener(){}
 };
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-11-24T12:00:00Z']));}}
 const document={createElement:()=>new Element(),addEventListener(){},removeEventListener(){}};
 vm.runInNewContext(source,{window:win,document,Date:FixedDate,Intl,ResizeObserver:class{observe(){}disconnect(){}}});
 const api=win.OrdersOverview.mount(host,{initial,read:async()=>initial,onPeriod(){},onExpenses(){}});
 const receive=days=>api.setImported({count:days.reduce((n,d)=>n+d.count,0),sizes:[0,0,0],averageDaily:1,elapsedDays:30,metrics:{year:2026,month,days}});
 const click=key=>cards.get(key).querySelector('button').onclick();
 return {api,popup,cards,receive,click};
}

test('new server earnings refresh the open Gross Revenue breakdown and total in place',()=>{
 for(const month of [11,0]){
  const f=fixture(month);try{
   const day={metric_date:'2026-11-05',count:3,revenue:3000,processed_revenue:1000,unprocessed_revenue:2000,pending_earnings:1,cost:500,gross:500,profit_count:1};
   f.receive([day]);f.click('revenue');
   assert.equal(f.popup.value,'$30.00');assert.match(f.popup.html,/<dt>Processed Order Earnings<\/dt><dd>\$10.00/);
   assert.equal(f.popup.options.compactRows,true);assert.equal(f.popup.options.anchorTop,undefined);
   const anchor=f.popup.active;
   f.receive([{...day,revenue:1800,processed_revenue:1800,unprocessed_revenue:0,pending_earnings:0}]);
   assert.equal(f.popup.openCalls,1);assert.equal(f.popup.closeCalls,0);assert.equal(f.popup.active,anchor);assert.equal(f.popup.updateCalls,1);
   assert.equal(f.popup.value,'$18.00');assert.equal(f.cards.get('revenue').querySelector('strong').textContent,'$18.00');
   assert.match(f.popup.html,/<dt>Unprocessed Order Earnings<\/dt><dd>\$0.00/);
   assert.match(f.popup.html,/<dt>Orders Awaiting Earnings<\/dt><dd>0/);
   assert.match(f.popup.html,/<dt>Total Gross Revenue<\/dt><dd>\$18.00/);
   assert.equal((f.popup.html.match(/<dt>/g)||[]).length,5);
  }finally{f.api.dispose();}
 }
});

test('saved buying costs update an open Product Cost popup without reopening it',()=>{
 for(const month of [11,0]){
  const f=fixture(month);try{
   const day={metric_date:'2026-11-05',count:2,revenue:3000,processed_revenue:3000,unprocessed_revenue:0,cost:1000,shipping:200,additional:50,pending_cost:1};
   f.receive([day]);f.click('cost');
   assert.equal(f.popup.value,'$12.50');assert.match(f.popup.html,/<dt>Orders Awaiting Buying Price<\/dt><dd>1/);
   f.receive([{...day,cost:1600,shipping:300,additional:100,pending_cost:0}]);
   assert.equal(f.popup.value,'$20.00');assert.equal(f.popup.openCalls,1);assert.equal(f.popup.closeCalls,0);assert.equal(f.popup.updateCalls,1);
   assert.match(f.popup.html,/<dt>Buying Price<\/dt><dd>\$16.00/);
   assert.match(f.popup.html,/<dt>Shipping Cost<\/dt><dd>\$3.00/);
   assert.match(f.popup.html,/<dt>Additional Cost<\/dt><dd>\$1.00/);
   assert.match(f.popup.html,/<dt>Orders Awaiting Buying Price<\/dt><dd>0/);
   assert.equal((f.popup.html.match(/<dt>/g)||[]).length,6);
  }finally{f.api.dispose();}
 }
});

test('a popup opened during loading fills in after the period response arrives',()=>{
 const f=fixture();try{
  f.click('revenue');assert.match(f.popup.html,/Loading selected period/);
  f.receive([{metric_date:'2026-11-05',count:1,revenue:500,processed_revenue:500,unprocessed_revenue:0}]);
  assert.equal(f.popup.openCalls,1);assert.equal(f.popup.updateCalls,1);assert.equal(f.popup.value,'$5.00');
  assert.match(f.popup.html,/<dt>Period<\/dt><dd>November 2026/);
  f.api.setImported({count:99,sizes:[],averageDaily:1,elapsedDays:30,metrics:{year:2026,month:10,days:[]}});
  assert.equal(f.popup.value,'—');assert.match(f.popup.html,/Loading selected period/);
  f.receive([{metric_date:'2026-11-05',count:1,revenue:500,processed_revenue:500,unprocessed_revenue:0}]);
  assert.equal(f.popup.value,'$5.00');assert.match(f.popup.html,/<dt>Total Gross Revenue<\/dt><dd>\$5.00/);
 }finally{f.api.dispose();}
});
