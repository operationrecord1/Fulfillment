const assert=require('node:assert/strict'),S=require('./sheet-sizing');
const names=Object.keys(S.minimums),cols=names.map(key=>({key,width:key==='note'?200:130}));
const prefs={note:210,quantity:65},required={platform:140,status:155};
for(const width of [1580,1780]){const v=S.allocate(cols,prefs,required,width);assert(Math.abs(Object.values(v).reduce((a,b)=>a+b,S.rowNumberWidth)-width)<.001);for(const key of names)assert(v[key]>=Math.max(S.minimums[key],required[key]||0)-.001);}
const long=S.allocate(cols,prefs,{platform:650,status:450},1580);assert(long.platform>=650);assert(long.status>=450);assert(Object.values(long).reduce((a,b)=>a+b,S.rowNumberWidth)>1580);assert.deepEqual(prefs,{note:210,quantity:65});
const mobile=S.allocate(cols,prefs,{platform:300},0);assert.equal(mobile.platform,300);assert.equal(mobile.note,210);
console.log('PASS: readable dropdown widths, compact fit, overflow fallback, and saved width preservation');

const enlarged=S.allocate(cols,prefs,{platform:195,status:220},1580);assert(Math.abs(Object.values(enlarged).reduce((a,b)=>a+b,S.rowNumberWidth)-1580)<.001);assert(enlarged.platform>=195&&enlarged.status>=220);console.log('PASS: 50 percent larger dropdown allocation still fits 1600px desktop');

const weightedCols=[{key:'order_id',width:146},{key:'note',width:202},{key:'product_cost',width:101}];const initial=S.allocate(weightedCols,{}, {},0),target=Object.values(initial).reduce((a,b)=>a+b,S.rowNumberWidth)-40;const shrunk=S.allocate(weightedCols,{}, {},target);const a=1-shrunk.order_id/initial.order_id,b=1-shrunk.note/initial.note,c=1-shrunk.product_cost/initial.product_cost;assert(Math.abs(b/a-1.2)<1e-8);assert(Math.abs(c/a-1.4)<1e-8);console.log('PASS: exact 1 : 1.2 : 1.4 proportional shrink ratios');
const C=require('./dashboard-core');const investorCols=C.columns.filter(c=>C.investorFields.has(c[0])).map(c=>({key:c[0],type:c[2]}));assert.equal(investorCols.length,15);assert(!investorCols.some(c=>['purchase_id','platform'].includes(c.key)));for(const w of [1580,1900]){const x=S.allocate(investorCols,{}, {platform:80,status:120},w);assert(Math.abs(Object.values(x).reduce((a,b)=>a+b,33)-w)<.001);}console.log('PASS: investor 15-column layout fits desktop widths');
