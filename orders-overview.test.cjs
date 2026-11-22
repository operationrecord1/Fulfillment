const test=require('node:test'),assert=require('node:assert/strict');
global.OrderCore=require('./dashboard-core.js');global.OrderCharts=require('./dashboard-charts.js');
const {summarize}=require('./orders-overview.js');
const rows=[{year:2026,month:10,position:1,data:{order_id:'OCT',earning:100,product_cost:60,date:'2026-10-05'}},{year:2026,month:11,position:1,data:{order_id:'NOV',earning:20,product_cost:8,date:'2026-11-05'}}];
const data={rows,expenses:[{date:'2026-10-01',amount:10},{date:'2026-11-01',amount:2}],options:{tax_percentage:10}};
test('selected month isolates orders, expenses and daily chart',()=>{const {a,points}=summarize(data,2026,11);assert.equal(a.count,1);assert.equal(a.revenue,2000);assert.equal(a.expense,200);assert.equal(a.net,900);assert.equal(points.length,30);assert.equal(points[4].value,1200);});
test('full year preserves existing monthly tax calculation',()=>{const {a,points}=summarize(data,2026,0);assert.equal(a.count,2);assert.equal(a.revenue,12000);assert.equal(a.net,3600);assert.equal(points.length,12);assert.equal(points[9].value,2700);assert.equal(points[10].value,900);});
test('empty month has no stale orders or profit',()=>{const {a,points}=summarize(data,2026,12);assert.equal(a.count,0);assert.equal(a.net,0);assert.ok(points.every(p=>p.value===0));});
