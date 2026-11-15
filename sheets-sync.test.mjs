import test from 'node:test';
import assert from 'node:assert/strict';
import {projectYear,valueChunks,columnName} from './supabase/functions/sheets-sync/model.mjs';
const row=(position,data={},month=1)=>({id:month+'-'+position,year:2026,month,position,display_number:position,data});
test('January A, February AA, December KA; sparse rows preserve exact website position',()=>{
 const p=projectYear(2026,[row(10,{order_id:'0010'}),row(1,{order_id:'0001'},2)]);
 assert.equal(columnName(p.monthly[1].startColumn),'AA');assert.equal(columnName(p.monthly[11].startColumn),'KA');
 const chunks=[...valueChunks('Monthly Statement 2026',0,p.monthly[0].header,p.monthly[0].rows)];
 assert.equal(chunks[1].range,"'Monthly Statement 2026'!A2");assert.equal(chunks[1].values[9][0],'0010');
 assert.deepEqual(chunks[1].values[0],Array(17).fill(''));
});
test('clear retains blanks, row deletion shifts only supplied month and clears stale tail',()=>{
 const p=projectYear(2026,[row(1,{order_id:'a'}),row(3,{order_id:'c'}),row(1,{order_id:'February'},2)]);
 const c=[...valueChunks('Monthly Statement 2026',0,p.monthly[0].header,p.monthly[0].rows,5)][1];
 assert.equal(c.values[2][0],'c');assert.equal(c.values[1][0],'');assert.equal(c.values[4][0],'');
 const shifted=projectYear(2026,[row(1,{order_id:'a'}),row(2,{order_id:'c'}),row(1,{order_id:'February'},2)]);
 assert.equal(shifted.monthly[1].rows[0].values[0],'February');assert.equal(shifted.yearly.rows.length,3);
});
test('grouped gross and margin match website; gaps break groups; stable readable IDs',()=>{
 const p=projectYear(2026,[row(1,{order_id:'a',earning:100,product_cost:40}),row(2,{order_id:'a',product_cost:10}),row(4,{order_id:'a',earning:50,product_cost:30})]);
 assert.equal(p.yearly.rows[0][13],50);assert.equal(p.yearly.rows[0][14],'50.00%');
 assert.equal(p.yearly.rows[1][13],'');assert.equal(p.yearly.rows[2][13],20);
 assert.equal(p.yearly.rows[0][15],'FL-0000-0001');
});
test('text remains literal, deleted rows excluded, duplicate position fails safely',()=>{
 assert.equal(projectYear(2026,[row(1,{note:'=IMPORTXML("x")'})]).yearly.rows[0][5],'=IMPORTXML("x")');
 assert.equal(projectYear(2026,[{...row(1),deleted_at:'2026-01-01'}]).yearly.rows.length,0);
 assert.throws(()=>projectYear(2026,[row(1),row(1)]),/Duplicate/);
});
