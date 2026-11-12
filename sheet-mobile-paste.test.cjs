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
