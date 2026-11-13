const assert=require('node:assert/strict'),S=require('./sheet-model.js'),C=require('./dashboard-core.js');
const rows=[{id:'a',month:11,position:1,data:{order_id:'A',earning:30,product_cost:10}},{id:'b',month:11,position:3,data:{order_id:'A',earning:20,product_cost:5}}];
assert.equal(S.rowCount([]),20);assert.equal(S.rowCount(rows),23);
assert.deepEqual(S.insert(rows,2).map(r=>r.position),[1,4]);assert.deepEqual(S.remove(rows,1,1).map(r=>r.position),[2]);assert.equal(S.rowCount(S.remove(rows,1,3)),20);
const cells=[['a\tb','line\nnext','"quote"'],['','3','']];assert.deepEqual(S.parseTSV(S.toTSV(cells)),cells);assert.deepEqual(S.parseTSV('a\tb\r\nc\td\r\n'),[['a','b'],['c','d']]);
assert.equal(S.normalize('earning','$1,234.50',2026,11,[]),1234.5);assert.equal(S.normalize('date','11/9/2026',2026,11,[]),'2026-11-09');
assert.throws(()=>S.normalize('date','2026-12-01',2026,11,[]));assert.throws(()=>S.normalize('date','2026-11-31',2026,11,[]));assert.throws(()=>S.normalize('quantity','1.5',2026,11,[]));assert.throws(()=>S.normalize('gross','5',2026,11,[]));assert.equal(S.normalize('status','Unknown',2026,11,[]),'Unknown');
assert.equal(C.groups(rows).length,2);assert.equal(C.duplicates(rows).size,2);assert.equal(C.aggregate(rows,[]).count,1);assert.equal(C.aggregate(rows,[]).gross,3500);
assert.equal(C.groups(rows.map((r,i)=>({...r,position:i+1}))).length,1);
assert.equal(C.duplicates(rows,['purchase_id']).size,0);assert.equal(C.duplicates(rows,['order_id']).size,2);
console.log('PASS: sparse rows, insert/delete, blank tail, TSV roundtrip, validation, duplicate groups and protected fields');

for(const size of [50,100,200])for(const [last,expected] of [[0,20],[10,30],[size-12,size],[size-1,size],[size,size+20],[size+1,size+21],[size*2,size*2+20]])assert.equal(S.rowCount(last?[{position:last,data:{order_id:'A'}}]:[],size),expected);
assert.equal(S.hasInput({platform:'Amazon',status:'Delivered',order_url:'https://example.com'}),false);
assert.equal(S.hasInput({quantity:0}),true);assert.equal(S.hasInput({note:'text'}),true);assert.equal(S.hasInput({note:'  '}),false);
assert.equal(S.rowCount([{position:90,data:{platform:'Amazon'}}],50),20);
console.log('PASS: pagination blank tail caps at page boundaries until last row is populated; dropdown-only rows are empty');
