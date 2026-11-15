const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('sheet-grid.js','utf8');
function fixture(){
 const listeners=new Map(),frames=new Map();let seq=0,captured=false,rowReads=0,cellReads=0;
 const doc={elementFromPoint(){return null},addEventListener(k,f){listeners.set(k,f)},removeEventListener(k){listeners.delete(k)}};
 const win={OrderCore:require('./dashboard-core'),SheetModel:require('./sheet-model'),addEventListener(k,f){listeners.set('window:'+k,f)},removeEventListener(k){listeners.delete('window:'+k)}};
 const context={window:win,document:doc,innerWidth:1000,innerHeight:700,requestAnimationFrame(f){frames.set(++seq,f);return seq},cancelAnimationFrame(id){frames.delete(id)}};
 vm.runInNewContext(source,context);const grid=Object.create(win.OrderSheetGrid.prototype);
 grid.host={setPointerCapture(){captured=true},hasPointerCapture(){return captured},releasePointerCapture(){captured=false}};
 grid.scroll={scrollTop:2000,scrollLeft:0,getBoundingClientRect:()=>({top:20,bottom:650,left:0,right:900})};
 const rows=Array.from({length:200},(_,i)=>{
  const row={dataset:{row:String(i+1)},getBoundingClientRect(){rowReads++;return {top:150+i*28-grid.scroll.scrollTop,bottom:178+i*28-grid.scroll.scrollTop}}};
  const cells=Array.from({length:17},(_,c)=>({dataset:{r:String(i+1),c:String(c)},closest(){return this},getBoundingClientRect(){cellReads++;const rb=row.getBoundingClientRect();return {...rb,left:33+c*80-grid.scroll.scrollLeft,right:113+c*80-grid.scroll.scrollLeft}}}));
  row.querySelectorAll=()=>cells;return row;
 });
 grid.table={querySelector:()=>({getBoundingClientRect:()=>({bottom:150})}),querySelectorAll:selector=>selector==='tbody tr[data-row]'?rows:[]};
 const tick=time=>{assert.equal(frames.size,1,'one drag loop must own each frame');const [id,fn]=frames.entries().next().value;frames.delete(id);fn(time);};
 const start=(onMove=()=>{},onEnd=()=>{},onCancel=()=>{},axis='both')=>grid.dragTrack({pointerId:1,pointerType:'mouse',clientX:150,clientY:300},onMove,onEnd,onCancel,axis);
 const move=(y,x=150,buttons=1)=>listeners.get('pointermove')({pointerId:1,clientX:x,clientY:y,buttons});
 const stop=()=>listeners.get('pointerup')({pointerId:1});
 return {grid,rows,listeners,frames,doc,tick,start,move,stop,get captured(){return captured},reads(){return {rowReads,cellReads}},resetReads(){rowReads=0;cellReads=0}};
}
function travel(y,hz=60){const f=fixture();f.start();f.move(y);f.tick(0);const before=f.grid.scroll.scrollTop;for(let i=1;i<=hz;i++)f.tick(i*1000/hz);const distance=f.grid.scroll.scrollTop-before;f.stop();return distance;}
assert(Math.abs(travel(160)+travel(640))<1e-8,'equal edge penetration must travel equal distances up and down');
assert(Math.abs(travel(160)+324)<1e-8,'same 28px activation band and curve on both edges');
assert(Math.abs(travel(640,60)-travel(640,120))<1e-8,'distance is time-based, not display refresh based');
assert.equal(travel(180),0,'above the activation band must not move');
assert.equal(travel(620),0,'below the activation band must not move');
console.log('PASS: symmetric edge travel, neutral area, and identical 60/120Hz distance');

{
 const f=fixture();let endpoint=0;f.start(event=>{endpoint=+event.cellTarget.dataset.r;});f.move(-100);f.tick(0);f.resetReads();f.tick(16);
 const expected=f.rows.findIndex(row=>row.getBoundingClientRect().bottom>150)+1;
 assert.equal(endpoint,expected,'outside top follows first visible row, including its partially visible portion');
 // Reverse with the original anchor intact, and resolve the last visible row.
 f.move(850);f.tick(32);const bottom=f.rows.findLastIndex(row=>row.getBoundingClientRect().top<650)+1;
 assert.equal(endpoint,bottom,'outside bottom follows the last visible row');f.stop();
 assert(!f.captured);assert.equal(f.frames.size,0);assert.equal(f.listeners.size,0);assert.equal(f.grid.dragWheel,null);
}
{
 const f=fixture();f.start();f.move(-100);f.tick(0);f.resetReads();f.tick(16);const reads=f.reads();
 assert(reads.cellReads<=17,'edge hit testing must inspect only one row of cells');assert(reads.rowReads<40,'row lookup must not measure all 200 rows');f.stop();
}
console.log('PASS: exact top/bottom visible endpoints and bounded row/cell geometry reads');

{
 const f=fixture();f.start();f.move(175);f.tick(0);const before=f.grid.scroll.scrollTop;
 f.listeners.get('pointerout')({pointerId:1,clientX:150,clientY:175,relatedTarget:null});f.tick(16);
 assert(Math.abs((f.grid.scroll.scrollTop-before)-(-54*.016))<1e-8,'leaving must not rewrite the pointer to a faster edge position');f.stop();
}
{
 const f=fixture();let updates=0;const hit={dataset:{r:'80',c:'2'},closest(){return this}};f.doc.elementFromPoint=()=>hit;
 f.start(()=>updates++);for(let i=0;i<20;i++)f.move(300+i);assert.equal(updates,0,'pointer moves are coalesced before paint');f.tick(0);assert.equal(updates,1);
 f.move(321);f.tick(16);assert.equal(updates,1,'same cell does not repaint the whole range');hit.dataset.r='81';f.move(322);f.stop();assert.equal(updates,2,'release flushes latest pending endpoint');
}
console.log('PASS: pointer coordinates survive exit; frame coalescing and final endpoint flush');

{
 const f=fixture();let endpoint=0;f.start(event=>{endpoint=+event.cellTarget.dataset.r;});f.move(850);f.tick(0);
 f.grid.dragWheel();const before=f.grid.scroll.scrollTop;f.grid.scroll.scrollTop+=100;f.tick(16);
 assert.equal(f.grid.scroll.scrollTop,before+100,'native wheel owns scroll without an additional edge delta');assert(endpoint>0,'selection still tracks the wheel result');
 for(let time=32;time<=160;time+=16)f.tick(time);assert.equal(f.grid.scroll.scrollTop,before+100,'edge scrolling waits for wheel gesture to settle');f.tick(176);assert(f.grid.scroll.scrollTop>before+100,'edge scrolling resumes after native wheel ends');f.stop();
}
{
 const f=fixture();let cancelled=0,ended=0;f.start(()=>{},()=>ended++,()=>cancelled++);f.move(760,150,0);assert.equal(cancelled,1);assert.equal(f.frames.size,0,'released button outside must stop drag');f.start(()=>{},()=>ended++,()=>cancelled++);
 f.listeners.get('window:mouseup')({button:0});assert.equal(ended,1);assert.equal(f.frames.size,0);assert.equal(f.listeners.size,0);
 f.start(()=>{},()=>ended++,()=>cancelled++);f.move(300,150,0);assert.equal(cancelled,2);assert.equal(f.frames.size,0);
 f.start(()=>{},()=>ended++,()=>cancelled++);f.listeners.get('pointercancel')({pointerId:1});assert.equal(cancelled,3);assert(!f.captured);assert.equal(f.grid.dragWheel,null);
}
console.log('PASS: exclusive native wheel ownership, stationary outside continuation and complete release/cancel cleanup');

{
 const f=fixture();f.grid.scroll.clientTop=2;f.grid.scroll.clientLeft=1;f.grid.scroll.clientWidth=884;f.grid.scroll.clientHeight=614;
 const b=f.grid.bodyViewport();assert.deepEqual({...b},{left:1,right:885,top:150,bottom:636},'body viewport excludes sticky header, borders and scrollbar');
}
console.log('PASS: shared viewport geometry accounts for actual client area');

function horizontalTravel(direction,hz=60){const f=fixture();f.grid.scroll.scrollLeft=2000;f.start();f.move(300,direction<0?-10:910);f.tick(0);const before=f.grid.scroll.scrollLeft;for(let i=1;i<=hz;i++)f.tick(i*1000/hz);const distance=f.grid.scroll.scrollLeft-before;f.stop();return distance;}
assert(Math.abs(horizontalTravel(1)+horizontalTravel(-1))<1e-8,'equal horizontal edge penetration must travel equal distances with sufficient space');
assert(Math.abs(horizontalTravel(1,60)-horizontalTravel(1,120))<1e-8,'horizontal travel also uses elapsed time');
console.log('PASS: left/right symmetry and refresh-rate-independent travel without hard-boundary interference');

for(const direction of [-1,1]){
 const f=fixture();f.grid.scroll.scrollLeft=300;const gutter={dataset:{rowHead:'77'},closest(){return this}};
 f.grid.table.querySelector=selector=>({getBoundingClientRect:()=>selector==='tbody [data-row-head]'?{right:33}:{bottom:150}});
 f.doc.elementFromPoint=x=>x<33?gutter:null;let endpoint=null;f.start(event=>{if(event.cellTarget)endpoint=event.cellTarget;});f.move(300,direction<0?-10:910);f.tick(0);
 for(let time=16;time<=192;time+=16)f.tick(time);
 const row=f.rows.find(row=>{const b=row.getBoundingClientRect();return b.top<=300&&b.bottom>300}),visible=row.querySelectorAll('[data-r]').filter(cell=>{const b=cell.getBoundingClientRect();return b.right>33&&b.left<900;});
 assert.equal(endpoint,direction<0?visible[0]:visible.at(-1),'horizontal endpoint must follow the first/last visible data cell beyond the sticky gutter');f.stop();
}
console.log('PASS: horizontal left/right selection follows visible column beyond sticky row-number gutter');

for(const axis of ['x','y','both']){
 const f=fixture();f.grid.scroll.scrollLeft=300;f.start(()=>{},()=>{},()=>{},axis);f.move(-10,-10);f.tick(0);const top=f.grid.scroll.scrollTop,left=f.grid.scroll.scrollLeft;f.tick(16);
 assert.equal(f.grid.scroll.scrollTop!==top,axis!=='x','column drag must not move vertically');
 assert.equal(f.grid.scroll.scrollLeft!==left,axis!=='y','row/fill drag must not move horizontally');f.stop();
}
for(const kind of ['column','row','cell']){
 const f=fixture(),g=f.grid;let chosenAxis=null;g.count=200;g.cols=Array.from({length:17},()=>({}));g.selection={r:1,c:0,er:1,ec:0,kind:'cell'};g.host.focus=()=>{};g.commitEditor=()=>true;g.closePopup=()=>{};g.paint=()=>{};g.mobileInputMode=()=>false;g.select=(r,c,er,ec,type)=>{g.selection={r,c,er,ec,kind:type}};g.dragTrack=(event,onMove,onEnd,onCancel,axis)=>{chosenAxis=axis};
 const column={dataset:{col:'3'}},header={closest:()=>column},row={dataset:{rowHead:'80'}},cell={dataset:{r:'80',c:'3'}};
 const target={closest(selector){return kind==='column'&&selector==='.sheet-header-text'?header:kind==='row'&&selector==='[data-row-head]'?row:kind==='cell'&&selector==='[data-r]'?cell:null}};
 g.pointer({target,button:0,pointerType:'mouse',detail:1,preventDefault(){}});assert.equal(chosenAxis,kind==='column'?'x':kind==='row'?'y':'both','actual pointer handler must choose the gesture axis');
}
console.log('PASS: column drag scrolls horizontally, row drag vertically and cell drag both, from actual pointer routing');

function roundedDrag(){const f=fixture();let top=2000,left=300;f.grid.scroll.scrollHeight=6000;f.grid.scroll.clientHeight=630;f.grid.scroll.scrollWidth=5000;f.grid.scroll.clientWidth=900;Object.defineProperty(f.grid.scroll,'scrollTop',{get:()=>top,set:value=>{top=Math.max(0,Math.min(5370,Math.round(value)))}});Object.defineProperty(f.grid.scroll,'scrollLeft',{get:()=>left,set:value=>{left=Math.max(0,Math.min(4100,Math.round(value)))}});return f;}
for(const direction of [-1,1]){
 const f=roundedDrag(),view=f.grid.bodyViewport();f.start();f.move(direction<0?view.top+27:view.bottom-27,direction<0?view.left+27:view.right-27);f.tick(0);const top=f.grid.scroll.scrollTop,left=f.grid.scroll.scrollLeft;for(let i=1;i<=60;i++)f.tick(i*1000/60);assert.equal(f.grid.scroll.scrollTop-top,direction*18,'1px vertical penetration accumulates 18px/s');assert.equal(f.grid.scroll.scrollLeft-left,direction*18,'1px horizontal penetration has its own fractional carry');f.stop();
}
{
 const f=roundedDrag(),view=f.grid.bodyViewport();f.start();f.move(view.bottom-27);f.tick(0);f.tick(16);const before=f.grid.scroll.scrollTop;f.move(view.top+27);f.tick(32);assert.equal(f.grid.scroll.scrollTop,before,'reversal must not apply the old positive remainder');f.tick(48);assert.equal(f.grid.scroll.scrollTop,before-1);f.stop();
}
{
 const f=roundedDrag(),view=f.grid.bodyViewport();f.start();f.move(view.bottom-27);f.tick(0);f.tick(16);const before=f.grid.scroll.scrollTop;f.grid.dragWheel();f.grid.scroll.scrollTop+=10;for(let t=32;t<=176;t+=16)f.tick(t);f.tick(192);assert.equal(f.grid.scroll.scrollTop,before+10,'native wheel clears edge fractional carry before resume');f.stop();
}
console.log('PASS: 1px edge penetration accumulates slow motion on both axes with rounded offsets; reversal/wheel reset carry');
