import test from 'node:test';
import assert from 'node:assert/strict';
import {mirror} from './supabase/functions/sheets-sync/engine.mjs';
const claim=()=>({token:'lease',target:{employee_id:'employee',store_name:'Store',serial:1,spreadsheet_id:'sheet'},job:{year:2026,version:1,extents:{},progress:{}},rows:[{id:'a',year:2026,month:1,position:10,display_number:1,data:{order_id:'0001'}}]});
function harness({active=true}={}){
 const calls=[],writes=[];
 return {calls,writes,rpc:async(action,payload)=>{calls.push({action,payload});return action==='check'?{active}:{};},google:async(url,method,body)=>{
  if(!method)return {properties:{title:'Store - 1'},sheets:[]};
  writes.push({url,method,body});return {};
 }};
}
test('initial mirror allocates requested rows, keeps RAW IDs, and batches ranges',async()=>{
 const h=harness(),result=await mirror(claim(),h);assert.equal(result.complete,true);
 const additions=h.writes[0].body.requests.filter(r=>r.addSheet).map(r=>r.addSheet.properties);
 assert.equal(additions[0].gridProperties.rowCount,2001);assert.equal(additions[1].gridProperties.rowCount,20001);
 const write=h.writes.find(w=>w.url.includes('values:batchUpdate'));
 assert.equal(write.body.valueInputOption,'RAW');assert.ok(write.body.data.some(d=>d.range.endsWith('!A2')&&d.values[9]?.[0]==='0001'));
 assert.equal(h.calls.at(-1).action,'finish');
});
test('archived employee never mutates Google',async()=>{
 const h=harness({active:false});await assert.rejects(mirror(claim(),h),/archived/);assert.equal(h.writes.length,0);
});
test('deadline releases lease and preserves retry checkpoint',async()=>{
 const h=harness();let time=0;
 const result=await mirror(claim(),{...h,now:()=>time++*100,budgetMs:50});
 assert.equal(result.complete,false);assert.equal(h.calls.at(-1).action,'yield');
 assert.ok(h.calls.some(c=>c.action==='checkpoint'&&c.payload.extents['1']===10));
 assert.ok(!h.calls.some(c=>c.action==='finish'));
});
test('new revision resets checkpoint and clears previously written tail',async()=>{
 const c=claim();c.job.version=2;c.job.progress={version:1,cursor:999};c.job.extents={'1':20,yearly:5};
 const h=harness();await mirror(c,h);
 const data=h.writes.find(w=>w.url.includes('values:batchUpdate')).body.data;
 const january=data.find(d=>d.range==="'Monthly Statement 2026'!A2");
 assert.equal(january.values.length,20);assert.equal(january.values[19][0],'');
 assert.equal(h.calls.at(-1).payload.extents['1'],10);
});
test('failed write is never acknowledged as completed',async()=>{
 const h=harness(),google=h.google;
 await assert.rejects(mirror(claim(),{...h,google:async(...args)=>{if(args[0].includes('values:batchUpdate'))throw Error('HTTP 429');return google(...args);}}),/429/);
 assert.ok(!h.calls.some(c=>c.action==='finish'));
});
