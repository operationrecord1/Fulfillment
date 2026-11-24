const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'ebay-workspace.js'),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

// Exercise the actual workspace mount and save callbacks, with controllable RPC delivery.
// Layout is intentionally inert: these tests cover data races, not browser geometry.
function fixture(){
 class Element{
  constructor(){this.children=[];this.selectors=new Map();this.listeners=new Map();this.style={setProperty(){}};this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),toggle(){}};this.open=false;this.clientWidth=1100;}
  querySelector(selector){if(!this.selectors.has(selector))this.selectors.set(selector,new Element());return this.selectors.get(selector);}
  querySelectorAll(){return [];}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}
  removeEventListener(){}
  append(child){child.remove();child.parentElement=this;this.children.push(child);}
  prepend(child){child.remove();child.parentElement=this;this.children.unshift(child);}
  get firstChild(){return this.children[0]||null;}
  remove(){if(this.parentElement){const siblings=this.parentElement.children;siblings.splice(siblings.indexOf(this),1);this.parentElement=null;}}
  before(){} after(){} replaceChildren(){this.children=[];}
  getBoundingClientRect(){return {left:0,right:1100,top:0,bottom:800,width:1100,height:800};}
  setAttribute(){} focus(){} close(){this.open=false;}
 }
 const container=new Element(),document=new Element(),period={year:2026,month:11};
 document.createElement=()=>new Element();document.fonts={load:async()=>[]};document.hidden=false;
 const requests=[],links=[],imported=[],intervals=[];
 let overviewOptions,editorOptions,rowActionsOptions,refreshOptions,disposed=false,deferLinks=false;
 const client={rpc(name,args){
  if(name==='ebay_orders_period_page'){const pending=deferred();requests.push({...pending,args});return pending.promise;}
  if(name==='ebay_supplier_products_get'&&deferLinks){const pending=deferred();links.push(pending);return pending.promise;}
  if(name==='ebay_supplier_products_get')return Promise.resolve({data:{}});
  if(name==='ebay_note_status')return Promise.resolve({data:{pending:{}}});
  throw Error('Unexpected RPC '+name);
 }};
 const window={innerWidth:1100,EbayPresentation:{},OrderCore:{statuses:[]},OrderSheetGrid:function(){},
  OrdersOverview:{mount(host,options){overviewOptions=options;return {period:()=>({...period}),setImported:value=>imported.push(value),refresh(){},dispose(){disposed=true;}};}},
  OrderEditor:{mount(options){editorOptions=options;return {isOpen:()=>false,dispose(){}};}},
  OrderRowActions:{mount(options){rowActionsOptions=options;return {isOpen:()=>false,dispose(){}};}},
  OrderTitleTooltip:{mount:()=>({dispose(){}})},
  CommerceRefresh:{create(options){refreshOptions=options;return {tick(){return options.refresh();},dispose(){}};}}
 };
 window.OrderSheetGrid.prototype={closePopup(){this.popup=null;},paintPagination(){}};
 vm.runInNewContext(source,{window,document,ResizeObserver:class{observe(){} disconnect(){}},localStorage:{getItem(){return null;},setItem(){}},setInterval:fn=>(intervals.push(fn),intervals.length),clearInterval(){},setTimeout(){},clearTimeout(){},location:{}});
 const workspace=window.EbayWorkspace.mount({container,client,storeId:'fixture-store',view:'orders',workspace:{year:2026},readWorkspace:async()=>({}),navigate(){}});
 function reply(index,revenue,month=requests[index].args.period_month){requests[index].resolve({data:{rows:[],total:0,period_count:0,size_counts:[],average_daily_orders:0,elapsed_days:30,order_metrics:{year:2026,month,days:[{revenue}]},seller:'Fixture',store:'Fixture',counts:{},timezone:'America/Los_Angeles'}});}
 return {container,requests,links,imported,reply,dispose:()=>workspace.dispose(),
  save:()=>editorOptions.onSave(),saveNote:()=>rowActionsOptions.onSave(),poll:()=>refreshOptions.refresh(),
  period(month){period.month=month;overviewOptions.onPeriod();},
  deferLinks(value){deferLinks=value;},get disposed(){return disposed;}
 };
}

test('successful edits invalidate an inflight snapshot and coalesce one immediate fresh read',async()=>{
 const f=fixture();
 try{
  f.save();f.save();
  assert.equal(f.requests.length,1,'saved edits queue behind the current read');
  f.reply(0,100);await settle();
  assert.equal(f.imported.length,0,'the pre-save totals never paint');
  assert.equal(f.requests.length,2,'queued saves coalesce without waiting for the polling interval');
  f.reply(1,240);await settle();
  assert.equal(f.imported.length,1);assert.equal(f.imported[0].metrics.days[0].revenue,240);
  assert.equal(f.container.classes.has('ebay-loading'),false);
 }finally{f.dispose();}
});

test('a save during a supplementary RPC also discards the old metrics response',async()=>{
 const f=fixture();
 try{
  f.deferLinks(true);f.reply(0,100);await settle();
  assert.equal(f.links.length,1);
  f.save();f.deferLinks(false);f.links[0].resolve({data:{}});await settle();
  assert.equal(f.imported.length,0);assert.equal(f.requests.length,2);
  f.reply(1,360);await settle();assert.equal(f.imported[0].metrics.days[0].revenue,360);
 }finally{f.dispose();}
});

test('an invalidated periodic refresh reports failure instead of acknowledging stale data',async()=>{
 const f=fixture();
 try{
  f.reply(0,100);await settle();
  const poll=f.poll();assert.equal(f.requests.length,2);
  f.saveNote();f.reply(1,100);
  assert.equal(await poll,false);await settle();
  assert.equal(f.imported.length,1);assert.equal(f.requests.length,3);
  f.reply(2,480);await settle();assert.equal(f.imported.at(-1).metrics.days[0].revenue,480);
 }finally{f.dispose();}
});

test('switching to the full year consumes a queued saved-edit refresh without restoring the old month',async()=>{
 const f=fixture();
 try{
  f.save();f.period(0);assert.equal(f.requests.length,2);
  assert.equal(f.requests[1].args.period_month,0);
  f.reply(1,1200);await settle();
  f.reply(0,100);await settle();
  assert.equal(f.imported.length,1);assert.equal(f.imported[0].metrics.month,0);
  assert.equal(f.imported[0].metrics.days[0].revenue,1200);
  assert.equal(f.requests.length,2,'the newer period request already includes committed edits');
 }finally{f.dispose();}
});

test('disposing the Orders page cancels a queued post-save refresh',async()=>{
 const f=fixture();f.save();f.dispose();f.reply(0,100);await settle();
 assert.equal(f.disposed,true);assert.equal(f.requests.length,1);assert.equal(f.imported.length,0);
 f.save();await settle();assert.equal(f.requests.length,1);
});
