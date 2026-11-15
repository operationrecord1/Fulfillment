import test from 'node:test';
import assert from 'node:assert/strict';
import {projectYear,linkChunks} from './supabase/functions/sheets-sync/model.mjs';
const row=(position,data,month=1)=>({id:String(position),year:2026,month,position,data,display_number:position});
test('preserves linked labels, explicit removals, custom cell links and safe schemes',()=>{
 const p=projectYear(2026,[row(1,{order_id:'0001',order_url:'https://example.com/old',purchase_id:'P1',purchase_url:'https://example.com/p',note:'Info'}),row(2,{order_id:'0002',order_url:'javascript:alert(1)'})],{1:{1:{order_id:{href:''},note:{href:'https://example.com/note'}}}});
 assert.equal(p.monthly[0].rows[0].values[0],'0001');assert.equal(p.monthly[0].rows[0].links[0],'');assert.equal(p.yearly.links[0][3],'https://example.com/p');assert.equal(p.yearly.links[0][5],'https://example.com/note');assert.equal(p.yearly.links[1][0],'');
});
test('moved links follow position and deleted tail links clear only the month block',()=>{
 const p=projectYear(2026,[row(2,{order_id:'x',order_url:'https://example.com/x'},2)]);
 const request=[...linkChunks(123,26,p.monthly[1].rows,3)][0].updateCells;
 assert.deepEqual(request.start,{sheetId:123,rowIndex:1,columnIndex:26});assert.equal(request.rows.length,3);assert.equal(request.rows[1].values[0].userEnteredFormat.textFormat.link.uri,'https://example.com/x');assert.deepEqual(request.rows[2].values[0].userEnteredFormat.textFormat,{});assert.equal(request.rows[0].values.length,17);
});
