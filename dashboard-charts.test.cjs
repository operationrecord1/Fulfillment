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
assert.ok(C.roundChart(a,true).includes('>0.01%</text>'));
assert.ok(C.roundChart(a,false).includes('>0.01</text>'));
const rows=[{data:{date:'2026-01-01',order_id:'A',earning:1.23,product_cost:0}},{data:{date:'2026-01-02',order_id:'A',earning:0,product_cost:.23}},{data:{date:'2026-02-01',order_id:'B',earning:0,product_cost:.5}}];
const pts=[['2026-01-01',123],['2026-01-02',-23],['2026-02-01',-50]];
const year=C.calendarPoints(pts,rows,2026,'all');assert.equal(year.length,12);assert.equal(year[0].value,100);assert.equal(year[0].count,1);assert.equal(year[1].value,-50);assert.equal(year.reduce((s,p)=>s+p.value,0),50);
assert.equal(C.calendarPoints(pts,rows,2026,2).length,28);assert.equal(C.calendarPoints([],[],2028,2).length,29);
for(const p of [year,C.calendarPoints([],[],2026,11)]){const svg=C.profitChart(p,true);assert.ok(!/NaN|Infinity/.test(svg));assert.equal((svg.match(/class="om-chart-hit om-profit-point"/g)||[]).length,p.length);}
console.log('PASS: readable IDs, date/leap-year rules, tiny exact labels, monthly totals, unique counts and empty charts');

const undated=C.calendarPoints([], [{month:11,year:2026,position:1,data:{order_id:'UNDATED',earning:20,product_cost:3}}],2026,'all');assert.equal(undated[10].value,1700);assert.equal(undated[10].count,1);

for(const cents of [-97,-10000,-1000000]){const svg=C.profitChart([{index:0,label:'1',full:'1 November 2026',count:1,value:cents}],false);assert.ok(svg.includes('class="om-loss-marker"'));assert.ok(svg.includes('height="3"'));assert.ok(!svg.includes('min-width'));assert.ok(!svg.includes('NaN'));}
assert.deepEqual(C.sliceShares([1,999]),[.001,.999]);
