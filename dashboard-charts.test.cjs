const assert=require('node:assert/strict');
const C=require('./dashboard-charts.js'),S=require('./sheet-model.js');
assert.equal(C.dateLabel('2026-11-01'),'1 November 2026');
assert.equal(C.dateLabel('2028-02-29'),'29 February 2028');
assert.equal(S.normalize('date','1',2026,11,[]),'2026-11-01');
assert.throws(()=>S.normalize('date','29',2026,2,[]));
assert.equal(S.normalize('date','29',2028,2,[]),'2028-02-29');
assert.equal(C.orderLabel('1'),'FL-0000-0001');
assert.equal(C.orderLabel('99999999'),'FL-9999-9999');
assert.equal(C.orderLabel(null),'');
for(const values of [[1,9999,0],[1,1,999999],[0,0,0],[10,20,30]]){const shares=C.sliceShares(values);if(values.some(Boolean))assert.ok(Math.abs(shares.reduce((a,b)=>a+b,0)-1)<1e-10);shares.forEach((s,i)=>assert.ok(values[i]?s>0:s===0));}
const a={count:10000,sizes:[{name:'Small',count:1,profit:1},{name:'Medium',count:9999,profit:9999},{name:'Large',count:0,profit:0}]};
assert.ok(C.roundChart(a,true).includes('>1</text>'));
assert.ok(C.roundChart(a,false).includes('>0.01</text>'));
const rows=[{data:{date:'2026-01-01',order_id:'A',earning:1.23,product_cost:0}},{data:{date:'2026-01-02',order_id:'A',earning:0,product_cost:.23}},{data:{date:'2026-02-01',order_id:'B',earning:0,product_cost:.5}}];
const pts=[['2026-01-01',123],['2026-01-02',-23],['2026-02-01',-50]];
const year=C.calendarPoints(pts,rows,2026,'all');assert.equal(year.length,12);assert.equal(year[0].value,100);assert.equal(year[0].count,1);assert.equal(year[1].value,-50);assert.equal(year.reduce((s,p)=>s+p.value,0),50);
assert.equal(C.calendarPoints(pts,rows,2026,2).length,28);assert.equal(C.calendarPoints([],[],2028,2).length,29);
for(const p of [year,C.calendarPoints([],[],2026,11)]){const svg=C.profitChart(p,true);assert.ok(!/NaN|Infinity/.test(svg));assert.equal((svg.match(/class="om-chart-hit om-profit-point(?: is-loss)?"/g)||[]).length,p.length);}
console.log('PASS: readable IDs, date/leap-year rules, tiny exact labels, monthly totals, unique counts and empty charts');

const undated=C.calendarPoints([], [{month:11,year:2026,position:1,data:{order_id:'UNDATED',earning:20,product_cost:3}}],2026,'all');assert.equal(undated[10].value,1700);assert.equal(undated[10].count,1);

for(const cents of [-97,-10000,-1000000]){const svg=C.profitChart([{index:0,label:'1',full:'1 November 2026',count:1,value:cents}],false);assert.ok(svg.includes('class="om-loss-marker"'));assert.ok(svg.includes('height="3"'));assert.ok(!svg.includes('min-width:'));assert.ok(!svg.includes('NaN'));}
assert.deepEqual(C.sliceShares([1,999]),[.001,.999]);

const dense=Array.from({length:31},(_,index)=>({index,label:String(index+1),full:'Day '+(index+1),count:1,value:index%3===0?-97:125}));const denseSVG=C.profitChart(dense,false);assert.ok((denseSVG.match(/class="om-profit-value"/g)||[]).length<=20);assert.equal((denseSVG.match(/class="om-loss-value"/g)||[]).length,11);assert.ok(!C.roundChart(a,false).includes('stroke="'+ '#53ae9b' +'" fill="none"'));

const Core=require('./dashboard-core.js');const boundary=[11.99,12,29.99,30].map((earning,i)=>({position:i+1,month:11,data:{order_id:String(i),earning,product_cost:1}}));assert.deepEqual(Core.aggregate(boundary,[]).sizes.map(s=>s.count),[1,2,1]);const duplicate=Core.aggregate([{position:1,data:{order_id:'A',earning:7,product_cost:2}},{position:2,data:{order_id:'B',earning:30,product_cost:40}},{position:3,data:{order_id:'A',earning:5,product_cost:3}}],[]);assert.equal(duplicate.count,2);assert.deepEqual(duplicate.sizes.map(s=>s.count),[0,1,1]);assert.deepEqual(duplicate.sizes.map(s=>s.profit),[0,700,-1000]);for(const donut of [true,false]){assert.ok(C.roundChart(Core.aggregate([],[]),donut).includes('No orders this period'));assert.ok(!C.roundChart(duplicate,donut).includes('%'));}assert.ok(!C.roundChart(Core.aggregate([{data:{order_id:'zero',earning:12,product_cost:12}}],[]),false).includes('No orders this period'));

const shared=[{month:11,position:1,group_key:'shared',group_profit:25,data:{order_id:'S',purchase_id:'P',earning:10,product_cost:5}},{month:11,position:2,group_key:'shared',group_profit:25,data:{order_id:'L',purchase_id:'P',earning:30,product_cost:10}}];for(const investor of [false,true]){const a=Core.aggregate(shared,[],investor);assert.equal(a.gross,2500);assert.deepEqual(a.sizes.map(s=>s.profit),[500,0,2000]);}

const bigAmounts=Array.from({length:31},(_,index)=>({index,label:String(index+1),full:'Day '+(index+1),count:1,value:index%2?-999999:-100000}));const stable=C.profitChart(bigAmounts,false);assert.equal((stable.match(/class="om-loss-value"/g)||[]).length,31);assert.ok(stable.includes('-9999.99'));assert.ok(!stable.includes('NaN'));assert.ok(!stable.includes('rotate('));

for(const width of [250,320,600,800,1200,1700])for(const sign of [-1,1]){const points=bigAmounts.map(p=>({...p,value:Math.abs(p.value)*sign}));const l=C.profitLayout(points,width);for(const item of l.items){const a=item.label;if(!a)continue;assert.ok(a.y>=0&&a.y<l.h);assert.ok(a.x-a.half>=0&&a.x+a.half<=l.w);assert.ok(sign<0?a.y>l.base:a.y<item.yt);for(const other of l.items){if(item===other)continue;const b=other.label;if(!b)continue;assert.ok(Math.abs(a.y-b.y)>=14||Math.abs(a.x-b.x)>=a.half+b.half+3);}}}

for(const text of ['1.00','10000.00','999999.99'])for(const width of [8,12,20,26])for(const height of [.01,10,30,40,100]){const f=C.profitCandleFit(text,width,height);assert.ok(f.height<=height*1.2+1e-8);if(f.font){assert.ok(f.font>=7.7-1e-8&&f.font<=11);assert.ok(f.font+4<=width+1e-8);assert.ok(text.length*.62*f.font+4<=f.height+1e-8);}}const hover=C.profitChart([-1,0,100].map((value,index)=>({value,index,count:1,label:String(index),full:'Day'})),false);assert.equal((hover.match(/is-loss/g)||[]).length,1);
