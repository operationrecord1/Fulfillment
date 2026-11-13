const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
const core=require('./dashboard-core'),model=require('./sheet-model'),formats=require('./sheet-format-model');
const listeners=new Map(),document={addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:(key,fn)=>{if(listeners.get(key)===fn)listeners.delete(key);}};
const context={window:{OrderCore:core,SheetModel:model,SheetFormatModel:formats},structuredClone,crypto,document,Date};vm.runInNewContext(fs.readFileSync('sheet-grid.js','utf8'),context);
const prototype=context.window.OrderSheetGrid.prototype;
const grid=Object.create(prototype);
Object.assign(grid,{editable:true,year:2026,month:11,rows:[],cols:core.columns.map(([key,label,type])=>({key,label,type})),selection:{r:1,c:0,er:1,ec:0},platforms:['Amazon'],formats:{},commitEditor:()=>true,checkpoint(){this.checkpoints=(this.checkpoints||0)+1;},changed(){this.count=model.rowCount(this.rows);},select(){},say(message){throw Error(message)}});
grid.pasteText(Array.from({length:1000},(_,i)=>'ORDER-'+(i+1)+'\t1\t12.50').join('\n'));
assert.equal(grid.rows.length,1000);assert.equal(grid.count,1020);assert.equal(grid.rows[999].data.order_id,'ORDER-1000');assert.equal(grid.checkpoints,1);
const saved=structuredClone(grid.rows);grid.say=message=>grid.error=message;grid.pasteText('OTHER\tinvalid\t12');assert.equal(JSON.stringify(grid.rows),JSON.stringify(saved));assert.match(grid.error,/No cells were pasted/);
const touch=Object.create(prototype),cell={dataset:{r:'2',c:'0'}},target={closest:s=>s==='[data-r]'?cell:null};
Object.assign(touch,{cols:[{type:'text'}],commitEditor:()=>true,closePopup(){},select(r,c){this.selection={r,c};},startEdit(){this.opened=(this.opened||0)+1;}});
const down={target,pointerId:1,clientX:20,clientY:40};
touch.touchPointer(down);listeners.get('pointerup')({pointerId:1});assert.equal(touch.opened,undefined);
touch.touchPointer(down);listeners.get('pointerup')({pointerId:1});assert.equal(touch.opened,1);
touch.touchPointer(down);listeners.get('pointermove')({pointerId:1,clientX:20,clientY:100});listeners.get('pointerup')({pointerId:1});assert.equal(touch.opened,1);assert.equal(touch.lastTouch,null);
touch.touchPointer(down);listeners.get('pointercancel')({pointerId:1});assert.equal(listeners.size,0);
console.log('PASS: 1000-row paste + 20 blank rows, one undo checkpoint, atomic invalid paste, touch double-tap, swipe and cancel');


context.window.matchMedia=()=>({matches:true});touch.touchPointer(down);listeners.get('pointerup')({pointerId:1});assert.equal(touch.opened,2);console.log('PASS: mobile single tap starts the editor without waiting for double tap');
const headerGrid=Object.create(prototype),header={dataset:{col:'2'}};
const headerText={closest:selector=>selector==='[data-col]'?header:null};
const headerTarget={closest:selector=>selector==='.sheet-header-text'?headerText:selector==='[data-col]'?header:null};
let prevented=false,paints=0;
Object.assign(headerGrid,{count:75,commitEditor:()=>true,closePopup(){},paint(){paints++;}});
headerGrid.pointer({target:headerTarget,button:0,pointerType:'mouse',preventDefault(){prevented=true;}});
assert.equal(headerGrid.selection.kind,'column');assert.equal(headerGrid.selection.c,2);assert.equal(headerGrid.selection.r,1);assert.equal(headerGrid.selection.er,75);assert.equal(prevented,false);assert.equal(paints,1);
const touchHeaderTarget={closest:selector=>selector==='[data-col]'?{dataset:{col:'1'},closest:()=>({dataset:{col:'1'}})}:null};
headerGrid.pointer({target:touchHeaderTarget,button:0,pointerType:'touch',preventDefault(){prevented=true;}});assert.equal(headerGrid.selection.c,1);assert.equal(headerGrid.selection.kind,'column');
context.window.getSelection=()=>({isCollapsed:false,anchorNode:{parentElement:{closest:()=>headerText}}});
headerGrid.clipboardEvent({target:headerTarget,preventDefault(){throw Error('Native header copying was blocked');}},false);
console.log('PASS: header text and touch header select entire column, preserve native text selection and copy');
const fillGrid=Object.create(prototype),fillRows=[1,2,3].map(position=>({position,data:{order_id:'ORDER-'+position,platform:position===1?'Amazon':'AutoDS'}}));
Object.assign(fillGrid,{selection:{r:1,c:0,er:1,ec:0,kind:'cell'},cols:[{key:'platform'}],rows:fillRows,formats:{},slots:[1,3],platforms:['Amazon','AutoDS'],year:2026,month:11,raw:()=> 'Amazon',canEdit:()=>true,paint(){},scroll:{scrollTop:0,getBoundingClientRect:()=>({top:0,bottom:500})},checkpoint(){this.checkpoints=(this.checkpoints||0)+1;},assign(row,c,value){row.data.platform=value;},changed(){this.didChange=true;},select(){}});
document.elementFromPoint=()=>({closest:()=>({dataset:{r:'3',c:'0'}})});
fillGrid.fillDrag({pointerId:8});listeners.get('pointermove')({pointerId:8,clientX:30,clientY:100});listeners.get('pointerup')({pointerId:8});
assert.equal(fillRows[2].data.platform,'Amazon');assert.equal(fillRows[1].data.platform,'AutoDS');assert.equal(fillGrid.checkpoints,1);assert.equal(fillGrid.didChange,true);assert.equal(listeners.size,0);
console.log('PASS: platform fill copies selected value into visible destination rows, preserves filtered rows, and records one undo checkpoint');
// Fill applies only to editable fields, preserves zero and links, and is undoable as one action.
for(const [key,label,type] of core.columns){
 if(type==='computed')continue;
 const index=core.columns.findIndex(c=>c[0]===key),value=key==='date'?'2026-11-12':type==='number'||type==='money'?0:key==='platform'?'Amazon':key==='status'?'Delivered':'SOURCE';
 const g=Object.create(prototype);Object.assign(g,{editable:true,year:2026,month:11,rows:[{position:1,data:{order_id:'ID1',[key]:value}},{position:2,data:{order_id:'ID2'}}],cols:core.columns.map(([key,label,type])=>({key,label,type})),formats:{1:{[key]:{href:'https://example.com/order'}}},slots:[1,2,3],selection:{r:1,c:index,er:1,ec:index},platforms:['Amazon'],paint(){},scroll:{scrollTop:0,getBoundingClientRect:()=>({top:0,bottom:500})},checkpoint(){this.before={rows:structuredClone(this.rows),formats:structuredClone(this.formats)};this.checkpoints=(this.checkpoints||0)+1;},changed(){},select(){}});
 document.elementFromPoint=()=>({closest:()=>({dataset:{r:'3',c:String(index)}})});
 g.fillDrag({pointerId:9});listeners.get('pointermove')({pointerId:9,clientX:30,clientY:100});listeners.get('pointerup')({pointerId:9});
 assert.equal(g.rows[1].data[key],value,key);assert.equal(g.formats[2][key].href,'https://example.com/order');assert.equal(g.checkpoints,1);
 if(type==='select')assert.equal(g.rows.length,2);else assert.equal(g.rows[2].data[key],value);
 assert.equal(g.before.rows[1].data[key],key==='order_id'?'ID2':undefined);assert.equal(listeners.size,0);
}
for(const key of ['gross','margin','id']){const g=Object.create(prototype);Object.assign(g,{editable:true,cols:[{key,type:'computed'}],selection:{r:1,c:0},raw:()=>42});g.fillDrag({pointerId:10});assert.equal(listeners.size,0);}
console.log('PASS: all editable fields fill down, zero values, links, one undo snapshot, computed fields locked');
