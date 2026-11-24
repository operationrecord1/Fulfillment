const assert=require('node:assert/strict'),C=require('./dashboard-core'),I=require('./dashboard-insights');
const test=require('node:test');
const row=(position,order_id,earning,product_cost,status,purchase_id='')=>({position,month:11,data:{order_id,earning,product_cost,status,purchase_id}});
const rows=[row(1,'A',10,15,'Refunded'),row(2,'B',12,5,'Delivered'),row(3,'B',3,1,'Delivered'),row(4,'C',30,10,'Pending'),row(5,'D',0,0,'Buyer Cancelled')];
const a=C.aggregate(rows,[]);
assert.equal(a.count,4);assert.deepEqual(I.shares(a,false).map(x=>x.percent),[50,25,25]);
const profit=I.shares(a,true);assert.equal(profit[0].percent,0);assert.equal(profit[0].profit,-500);assert.ok(Math.abs(profit.reduce((s,x)=>s+x.percent,0)-100)<1e-9);
const statuses=I.statusBreakdown(rows);for(const [key,field] of [['count','count'],['revenue','revenue'],['cost','cost'],['gross','profit']])assert.equal(statuses.reduce((s,x)=>s+x[field],0),a[key]);
assert.equal(statuses.find(x=>x.status==='Delivered').count,1);
assert.match(I.progress(a,true),/-\$5.00/);assert.match(I.progress(C.aggregate([],[]),true),/No Orders This Period/);
const zero=C.aggregate([row(1,'Z',1,1,'Delivered')],[]);assert.doesNotMatch(I.progress(zero,true),/No orders/);assert.equal(I.shares(zero,true).every(x=>x.percent===0),true);
assert.match(I.details('net',a,rows,[],false,15),/Net Profit/);
console.log('PASS: unique counts, signed category profits, positive-share denominator, zero/empty states, status totals and metric details');
const unsetRows=[row(1,'U',10,4,''),row(2,'',3,1,'')];const unset=I.statusBreakdown(unsetRows);assert.equal(unset.length,1);assert.equal(unset[0].status,'Unassigned');assert.equal(unset[0].count,1);assert.equal(unset[0].revenue,1300);assert.equal(unset[0].profit,C.aggregate(unsetRows,[]).gross);assert.doesNotMatch(I.details('count',C.aggregate(unsetRows,[]),unsetRows,[],false,15),/Not set/);console.log('PASS: unassigned orders and unassigned financial rows merge without losing totals');

assert.match(I.details('count',a,rows,[],false,15),/>-\$5\.00<\/span>/);
assert.match(I.details('count',a,rows,[],false,15),/>\$9\.00<\/span>/);

assert.equal(C.statusLabel('Buyer Cancelled'),'Cancelled');assert.equal(I.statusBreakdown([row(1,'C',10,2,'Buyer Cancelled')])[0].status,'Cancelled');

test('details popup omits only a null heading value and preserves normal and zero values',()=>{
 const oldDocument=global.document,oldWindow=global.window,listeners={};let opened=false,insights;
 const closeButton={focus(){}};
 const pop={style:{},scrollWidth:240,offsetWidth:242,offsetHeight:160,setAttribute(){},remove(){},
  addEventListener(name,fn){listeners[name]=fn;},matches(){return opened;},showPopover(){opened=true;},
  hidePopover(){listeners.beforetoggle?.({newState:'closed'});opened=false;},
  querySelector(selector){return selector==='button'?closeButton:null;}};
 const host={append(){},addEventListener(){},removeEventListener(){}};
 const button={setAttribute(){},closest(){return {getBoundingClientRect(){return {left:20,top:40,width:240};}};}};
 const body='<dl class="om-detail-pairs"><div><dt>Total Orders</dt><dd>1,041</dd></div></dl>';
 const heading=value=>'<div class="om-details-heading"><div><h3>Total Orders</h3>'+value+'</div><button type="button" aria-label="Close details">×</button></div>';
 try{
  global.document={createElement(){return pop;}};
  global.window={innerWidth:1024,innerHeight:768,addEventListener(){},removeEventListener(){}};
  insights=I.bind(host);
  insights.open(button,'Total Orders',null,body);
  assert.equal(pop.innerHTML,heading('')+body);
  insights.close();insights.open(button,'Total Orders','1,041',body);
  assert.equal(pop.innerHTML,heading('<strong>1,041</strong>')+body);
  insights.close();insights.open(button,'Total Orders',0,body);
  assert.equal(pop.innerHTML,heading('<strong>0</strong>')+body);
 }finally{
  insights?.destroy();
  if(oldDocument===undefined)delete global.document;else global.document=oldDocument;
  if(oldWindow===undefined)delete global.window;else global.window=oldWindow;
 }
});
