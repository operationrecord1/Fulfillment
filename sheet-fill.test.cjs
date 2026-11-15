const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('./dashboard-core'),model=require('./sheet-model'),formatModel=require('./sheet-format-model');
const context={window:{OrderCore:core,SheetModel:model,SheetFormatModel:formatModel},document:{elementFromPoint(){return null}},crypto:globalThis.crypto};
vm.runInNewContext(fs.readFileSync('sheet-grid.js','utf8'),context);
const url='https://www.ebay.com/mesh/ord/details?orderid=17-14961-22962';
function fixture(){
 const g=Object.create(context.window.OrderSheetGrid.prototype);let track,checkpoints=0,changes=0;
 Object.assign(g,{editable:true,investor:false,year:2026,month:11,platforms:['Amazon','AutoDS'],formats:{4:{order_id:{bold:true,href:'https://example.com/old'}}},selection:{r:3,c:0,er:7,ec:1,kind:'cell',activeR:5,activeC:0},cols:core.columns.map(([key,label,type])=>({key,label,type})),slots:Array.from({length:10},(_,i)=>i+1),rows:Array.from({length:10},(_,i)=>({position:i+1,data:{order_id:'ORIGINAL-'+(i+1),order_url:'https://example.com/'+(i+1),quantity:i+1,platform:'Amazon'}}))});
 g.rows[4].data.order_id='17-14961-22962';g.rows[4].data.order_url=url;
 g.dragTrack=(event,onMove,onEnd,onCancel,axis)=>{track={onMove,onEnd,onCancel,axis}};g.paint=()=>{};g.checkpoint=()=>checkpoints++;g.changed=()=>changes++;
 g.select=(r,c,er,ec,kind)=>{g.selection={r,c,er,ec,kind}};
 const move=row=>{const cell={dataset:{r:String(row)},closest(){return this}};track.onMove({cellTarget:cell})};
 return {g,move,start:()=>g.fillDrag({pointerId:1}),end:()=>track.onEnd({}),cancel:()=>track.onCancel(),get track(){return track},get checkpoints(){return checkpoints},get changes(){return changes}};
}
{
 const f=fixture(),before=structuredClone(f.g.rows);f.start();assert.equal(f.g.selection.r,5,'fill source is active cell, not original range anchor');assert.equal(f.g.selection.c,0);assert.equal(f.track.axis,'y','single-column fill restricts edge scrolling to vertical');f.move(2);f.end();
 for(const r of [2,3,4]){assert.equal(f.g.get(r).data.order_id,'17-14961-22962');assert.equal(f.g.linkDetails(r,0).url,url,'copied ID retains its link');}
 for(const r of [1,5,6,7,8,9,10])assert.deepEqual(f.g.get(r),before[r-1],'rows outside fill destination remain unchanged');
 assert.equal(f.g.formats[4].order_id.bold,true,'link copy preserves unrelated destination formatting');assert.equal(f.g.selection.r,5);assert.equal(f.g.selection.er,2);assert.equal(f.checkpoints,1);assert.equal(f.changes,1);
}
{
 const f=fixture();f.start();f.move(8);f.end();for(const r of [6,7,8])assert.equal(f.g.get(r).data.order_id,'17-14961-22962');assert.equal(f.g.get(4).data.order_id,'ORIGINAL-4');assert.equal(f.g.selection.er,8);assert.equal(f.checkpoints,1);
}
console.log('PASS: active-cell source, upward/downward fill, link preservation, unrelated formatting and bounded destination');
{
 const f=fixture(),previous=structuredClone(f.g.selection),rows=structuredClone(f.g.rows),formats=structuredClone(f.g.formats);f.start();f.move(1);f.cancel();assert.deepEqual({...f.g.selection},previous);assert.deepEqual(f.g.rows,rows);assert.deepEqual(f.g.formats,formats);assert.equal(f.checkpoints,0);assert.equal(f.changes,0);
}
{
 const f=fixture();f.start();f.move(5);f.end();assert.equal(f.checkpoints,0);assert.equal(f.changes,0,'releasing on the source does not create a data change');
}
{
 const f=fixture();f.g.rows[4].data.order_id='';f.start();assert.equal(f.track,undefined,'empty source cannot start fill');
}
console.log('PASS: cancel restores previous range without data changes, no-op and empty-source guards');
{
 const f=fixture();f.g.slots=[1,2,3,5,6,8,9,10];const editable=f.g.canEdit.bind(f.g);f.g.canEdit=(r,c)=>r!==8&&editable(r,c);f.start();f.move(8);f.end();assert.equal(f.g.get(6).data.order_id,'17-14961-22962');assert.equal(f.g.get(7).data.order_id,'ORIGINAL-7','filtered-out rows are not filled');assert.equal(f.g.get(8).data.order_id,'ORIGINAL-8','noneditable targets are not filled');
}
{
 const f=fixture(),platform=f.g.cols.findIndex(c=>c.key==='platform');f.g.selection={r:5,c:platform,er:5,ec:platform,kind:'cell'};f.g.rows[4].data.platform='AutoDS';f.start();f.move(3);f.end();assert.equal(f.g.get(3).data.platform,'AutoDS');assert.equal(f.g.get(4).data.platform,'AutoDS');
}
console.log('PASS: filtered/noneditable destinations are skipped and dropdown values fill upward');
