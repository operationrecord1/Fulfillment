const {test}=require('node:test'),assert=require('node:assert/strict'),{create}=require('./commerce-refresh.js');
test('unchanged revisions avoid heavy reloads and back off; changes refresh',async()=>{
let time=1000000,version='1',loads=0,probes=0;const p=create({now:()=>time,revision:async()=>{probes++;return version},refresh:async()=>{loads++;return true}});
await p.tick();assert.equal(loads,1);time+=15000;await p.tick();time+=15000;await p.tick();assert.equal(loads,1);
const n=probes;time+=15000;await p.tick();assert.equal(probes,n);time+=15000;version='2';await p.tick();assert.equal(loads,2);
});
test('failed refresh never acknowledges a newer version and overlapping ticks coalesce',async()=>{
let time=1000000,loads=0,release;const p=create({now:()=>time,revision:()=>new Promise(r=>release=r),refresh:async()=>{loads++;return loads>1}});
const first=p.tick();await p.tick();release('1');await first;assert.equal(loads,1);
time+=60000;const retry=p.tick();release('1');await retry;assert.equal(loads,2);
p.dispose();time+=60000;await p.tick();assert.equal(loads,2);
});
