const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const core=require('./dashboard-core.js'),model=require('./sheet-model.js'),formats=require('./sheet-format-model.js');
const context={window:{OrderCore:core,SheetModel:model,SheetFormatModel:formats},structuredClone};vm.runInNewContext(fs.readFileSync('sheet-grid.js','utf8'),context);
const grid=Object.create(context.window.OrderSheetGrid.prototype);
grid.scroll={scrollTop:2000,getBoundingClientRect:()=>({top:0})};grid.surface={getBoundingClientRect:()=>({top:-1500})};grid.prefix=Array.from({length:1001},(_,i)=>i*25);
assert.equal(grid.tableOffset(),500);assert.equal(grid.findStart(),48);
grid.surface.getBoundingClientRect=()=>({top:-1450});assert.equal(grid.findStart(),46);
grid.cols=[{key:'platform',type:'select'}];grid.rows=[{position:1,data:{platform:'custom-10'}}];grid.formats={1:{platform:{bold:true,options:Array.from({length:10},(_,i)=>'custom-'+(i+1))}},2:{platform:{options:['other-row']}}};grid.platforms=['Amazon'];grid.canEdit=()=>true;grid.raw=()=>grid.rows[0].data.platform;grid.changed=()=>{};grid.checkpoint=()=>{};grid.say=message=>{throw Error(message)};
assert.equal(grid.setCell(1,0,''),true);assert.equal(grid.rows[0].data.platform,'');assert.equal(grid.formats[1].platform.options.length,0);assert.equal(grid.formats[1].platform.bold,true);assert.deepEqual(grid.formats[2].platform.options,['other-row']);assert.deepEqual(grid.platforms,['Amazon']);
grid.formats[1].platform.options=['unselected-custom'];assert.equal(grid.setCell(1,0,''),true);assert.equal(grid.formats[1].platform.options.length,0);
console.log('PASS: central-scroll virtualization offsets and all-local-option cleanup without touching global/other-row options');

const yearly=Object.create(context.window.OrderSheetGrid.prototype);Object.assign(yearly,{rows:[{id:'a',month:1,position:1,data:{order_id:'A'}},{id:'b',month:11,position:2,data:{order_id:'B'}}],month:'all',year:2026,formats:{},preferences:{},selection:{r:1,er:1},dateTracker:new (require('./dashboard-session').MissingDateTracker)()});yearly.prepare();assert.deepEqual([...yearly.monthStarts],[1,2]);assert.deepEqual([...yearly.prefix],[0,57,114]);yearly.filter=r=>r?.month===11;yearly.prepare();assert.deepEqual([...yearly.monthStarts],[2]);assert.deepEqual([...yearly.prefix],[0,57]);console.log('PASS: yearly month bands retain undated rows, skip empty months, and contribute correct virtual heights');
