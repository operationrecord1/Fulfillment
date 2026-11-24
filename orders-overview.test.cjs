const test=require('node:test'),assert=require('node:assert/strict');
global.OrderCore=require('./dashboard-core.js');
const {summarize,orderCountRows,financialDetailRows}=require('./orders-overview.js');
const data={rows:[{data:{earning:999999}}],expenses:[{date:'2026-10-01',amount:10},{date:'2026-11-01',amount:2},{date:'2025-11-01',amount:1000}],options:{tax_percentage:10}};
const oct={metric_date:'2026-10-05',count:1,revenue:10000,cost:6000,gross:4000,margin_sum:40,margin_count:1,profit_count:1};
const nov={metric_date:'2026-11-05',count:1,revenue:2000,cost:800,gross:1200,margin_sum:60,margin_count:1,profit_count:1};
const metrics=(month,days)=>({year:2026,month,days,sizes:[]});
test('monthly Orders source ignores Dashboard sales and filters expenses',()=>{const {a,points}=summarize(data,2026,11,metrics(11,[nov]));assert.equal(a.count,1);assert.equal(a.revenue,2000);assert.equal(a.expense,200);assert.equal(a.net,900);assert.equal(points.length,30);assert.equal(points[4].value,1200);assert.equal(points[4].count,1);});
test('full year uses annual tax; chart shows monthly net results',()=>{const {a,points}=summarize(data,2026,0,metrics(0,[oct,nov]));assert.equal(a.count,2);assert.equal(a.revenue,12000);assert.equal(a.net,3600);assert.equal(points.length,12);assert.equal(points[9].value,2700);assert.equal(points[10].value,900);});
test('empty period clears all order metrics',()=>{const {a,points}=summarize(data,2026,12,metrics(12,[]));assert.equal(a.count,0);assert.equal(a.net,0);assert.ok(points.every(p=>p.value===0));});
test('rejects stale period metrics during selector changes',()=>{assert.equal(summarize(data,2026,10,metrics(11,[nov])),null);assert.equal(summarize(data,2025,11,metrics(11,[nov])),null);assert.equal(summarize(data,2026,11),null);});
test('monthly Total Orders details retain the order count and selected period',()=>{
 const summary=summarize(data,2026,11,metrics(11,[nov]));
 assert.deepEqual(orderCountRows(summary,2026,11),[['Orders','1'],['Period','November 2026']]);
 const empty=summarize(data,2026,12,metrics(12,[]));
 assert.deepEqual(orderCountRows(empty,2026,12),[['Orders','0'],['Period','December 2026']]);
});
test('yearly Total Orders details put the total below active months in calendar order',()=>{
 const days=[{metric_date:'2024-01-02',count:9},{metric_date:'2024-10-05',count:7},{metric_date:'2024-11-01',count:'1000'},{metric_date:'2024-11-25',count:25}];
 const summary=summarize({expenses:[]},2024,0,{year:2024,month:0,days});
 const chartPoints=structuredClone(summary.points);
 assert.deepEqual(orderCountRows(summary,2024,0),[['January 2024','9'],['October 2024','7'],['November 2024','1,025'],['Total Orders','1,041']]);
 assert.equal(summary.points.reduce((total,p)=>total+p.count,0),summary.a.count);
 assert.deepEqual(summary.points,chartPoints,'opening the popup must not reorder chart data');
});
test('yearly Total Orders details include every active month in a complete year',()=>{
 const days=Array.from({length:12},(_,i)=>({metric_date:'2026-'+String(i+1).padStart(2,'0')+'-01',count:i+1}));
 const summary=summarize(data,2026,0,metrics(0,days)),rows=orderCountRows(summary,2026,0);
 assert.equal(rows.length,13);
 assert.deepEqual(rows[0],['January 2026','1']);
 assert.deepEqual(rows[11],['December 2026','12']);
 assert.deepEqual(rows[12],['Total Orders','78']);
});
test('empty full year shows a zero total without inventing month rows',()=>{
 const summary=summarize(data,2026,0,metrics(0,[]));
 assert.deepEqual(orderCountRows(summary,2026,0),[['Total Orders','0']]);
});
test('gross includes all order costs; missing costs do not create fictional profit',()=>{const {a}=summarize({expenses:[]},2026,11,metrics(11,[{...nov,count:3,revenue:10000,cost:2000,shipping:300,additional:200,gross:1500,pending_cost:2,profit_count:1,margin_sum:37.5,margin_count:1}]));assert.equal(a.gross,1500);assert.equal(a.shipping,300);assert.equal(a.additional,200);assert.equal(a.pendingCost,2);assert.equal(a.avgProfit,500);assert.equal(a.margin,37.5);});
test('yearly loss offsets profit before annual tax as in Dashboard',()=>{const {a}=summarize({expenses:[],options:{tax_percentage:15}},2026,0,metrics(0,[{...oct,gross:10000},{...nov,gross:-9000}]));assert.equal(a.gross,1000);assert.equal(a.tax,150);assert.equal(a.net,850);});
test('same order amounts reproduce Dashboard financial formula',()=>{const rows=[{year:2026,month:11,data:{order_id:'a',date:'2026-11-05',earning:20,product_cost:8,shipping_cost:2,additional_cost:1}}],expenses=[{date:'2026-11-06',amount:2}],expected=global.OrderCore.aggregate(rows,expenses,false,15);const {a}=summarize({expenses},2026,11,metrics(11,[{...nov,cost:800,shipping:200,additional:100,gross:900,margin_sum:45}]));for(const k of ['revenue','gross','net','expense','tax','avgOrder','avgProfit','margin'])assert.equal(a[k],expected[k],k);assert.equal(a.cost,1100);assert.equal(a.baseCost,800);});

test('Gross Revenue has the agreed five rows and totals actual processed and unprocessed cents',()=>{
 const days=[{...nov,revenue:1550,processed_revenue:-450,unprocessed_revenue:2000,pending_earnings:3}];
 const summary=summarize(data,2026,11,metrics(11,days));
 assert.equal(summary.a.processedRevenue+summary.a.unprocessedRevenue,summary.a.revenue);
 assert.deepEqual(financialDetailRows('revenue',summary,2026,11),[
  ['Period','November 2026'],['Processed Order Earnings','-$4.50'],['Unprocessed Order Earnings','$20.00'],['Orders Awaiting Earnings','3'],['Total Gross Revenue','$15.50']
 ]);
});

test('yearly financial popups aggregate every selected month without inventing earnings for pending orders',()=>{
 const days=[{...oct,processed_revenue:'7000',unprocessed_revenue:'3000',pending_earnings:2,pending_cost:4,shipping:200,additional:50},{...nov,processed_revenue:-1000,unprocessed_revenue:3000,pending_earnings:1,pending_cost:2,shipping:100,additional:25}];
 const summary=summarize(data,2026,0,metrics(0,days));
 assert.equal(summary.a.processedRevenue+summary.a.unprocessedRevenue,summary.a.revenue);
 assert.deepEqual(financialDetailRows('revenue',summary,2026,0),[
  ['Period','Report of 2026'],['Processed Order Earnings','$60.00'],['Unprocessed Order Earnings','$60.00'],['Orders Awaiting Earnings','3'],['Total Gross Revenue','$120.00']
 ]);
 assert.deepEqual(financialDetailRows('cost',summary,2026,0),[
  ['Period','Report of 2026'],['Buying Price','$68.00'],['Shipping Cost','$3.00'],['Additional Cost','$0.75'],['Total Buying Cost','$71.75'],['Orders Awaiting Buying Price','6']
 ]);
});

test('reclassification and awaiting counts do not alter any existing financial calculations',()=>{
 const original=summarize(data,2026,11,metrics(11,[nov]));
 const changed=summarize(data,2026,11,metrics(11,[{...nov,processed_revenue:0,unprocessed_revenue:2000,pending_earnings:9,pending_cost:7}]));
 for(const key of ['count','revenue','baseCost','cost','shipping','additional','gross','expense','tax','net','margin','marginCount','avgOrder','avgProfit','profitCount','sizes'])assert.deepEqual(changed.a[key],original.a[key],key);
 assert.deepEqual(changed.points,original.points);
 assert.deepEqual(changed.expenses,original.expenses);
 const empty=summarize(data,2026,12,metrics(12,[]));
 assert.deepEqual(financialDetailRows('revenue',empty,2026,12).slice(1),[['Processed Order Earnings','$0.00'],['Unprocessed Order Earnings','$0.00'],['Orders Awaiting Earnings','0'],['Total Gross Revenue','$0.00']]);
});
