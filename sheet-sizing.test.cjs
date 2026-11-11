const assert=require('node:assert/strict'),S=require('./sheet-sizing');
const names=Object.keys(S.minimums),cols=names.map(key=>({key,width:key==='note'?200:130}));
const prefs={note:210,quantity:65},required={platform:140,status:155};
for(const width of [1580,1780]){const v=S.allocate(cols,prefs,required,width);assert(Math.abs(Object.values(v).reduce((a,b)=>a+b,45)-width)<.001);for(const key of names)assert(v[key]>=Math.max(S.minimums[key],required[key]||0)-.001);}
const long=S.allocate(cols,prefs,{platform:650,status:450},1580);assert(long.platform>=650);assert(long.status>=450);assert(Object.values(long).reduce((a,b)=>a+b,45)>1580);assert.deepEqual(prefs,{note:210,quantity:65});
const mobile=S.allocate(cols,prefs,{platform:300},0);assert.equal(mobile.platform,300);assert.equal(mobile.note,210);
console.log('PASS: readable dropdown widths, compact fit, overflow fallback, and saved width preservation');

const enlarged=S.allocate(cols,prefs,{platform:195,status:220},1580);assert(Math.abs(Object.values(enlarged).reduce((a,b)=>a+b,45)-1580)<.001);assert(enlarged.platform>=195&&enlarged.status>=220);console.log('PASS: 50 percent larger dropdown allocation still fits 1600px desktop');
