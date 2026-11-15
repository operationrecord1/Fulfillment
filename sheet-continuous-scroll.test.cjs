const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('sheet-grid.js','utf8');
function fixture(){
 const target=()=>({events:{},options:{},addEventListener(k,f,options){this.events[k]=f;this.options[k]=options;}}),document=target(),root=target(),scroll=target();
 document.documentElement=root;const host={style:{},isConnected:true,getClientRects:()=>[{}],contains:()=>true};let sequence=0,clock=1000;const frames=new Map();
 const context={window:{OrderCore:require('./dashboard-core'),SheetModel:require('./sheet-model')},document,AbortController,Date:{now:()=>clock},innerHeight:700,requestAnimationFrame(fn){frames.set(++sequence,fn);return sequence},cancelAnimationFrame(id){frames.delete(id)}};
 vm.runInNewContext(source,context);const grid=Object.create(context.window.OrderSheetGrid.prototype);grid.host=host;grid.scroll=scroll;scroll.scrollTop=2000;scroll.clientHeight=600;grid.installContinuousScroll();
 const element={closest:()=>null},wheel=(deltaY=40,extra={})=>scroll.events.wheel({target:element,deltaY,deltaX:0,...extra});
 const tick=time=>{assert.equal(frames.size,1);const [id,fn]=frames.entries().next().value;frames.delete(id);fn(time);};
 const click=button=>document.events.pointerdown({button,target:element,clientY:250,preventDefault(){},stopPropagation(){}});
 return {grid,document,root,scroll,host,frames,wheel,tick,click,setClock(value){clock=value}};
}
{
 const f=fixture();f.wheel();assert.equal(f.frames.size,0);
 f.root.events.pointerleave({clientY:701,buttons:0});assert.equal(f.frames.size,0,"leaving after wheel must not start automatic scrolling");
 f.wheel(-40);f.root.events.pointerleave({clientY:-1,buttons:0});assert.equal(f.frames.size,0,"upward wheel also stops with native input");
 f.setClock(4000);f.root.events.pointerleave({clientY:701,buttons:0});assert.equal(f.scroll.scrollTop,2000);
}
console.log('PASS: wheel never creates unsolicited continuation on pointer exit');
{
 const f=fixture();f.click(1);f.document.events.pointermove({clientY:300});f.tick(0);const before=f.scroll.scrollTop;f.tick(16);assert(Math.abs(f.scroll.scrollTop-before-304*.016)<1e-8);
 f.root.events.pointerleave({clientY:200});const at=f.scroll.scrollTop;f.tick(32);assert(Math.abs(f.scroll.scrollTop-at+304*.016)<1e-8,'middle auto-scroll uses the same origin-distance curve outside');
 f.click(0);assert.equal(f.frames.size,0);assert.equal(f.host.style.cursor,'');
 f.click(1);f.document.events.pointermove({clientY:255});f.tick(48);const neutral=f.scroll.scrollTop;f.tick(64);assert.equal(f.scroll.scrollTop,neutral,'middle dead zone stays still');f.grid.stopContinuousScroll();
}
console.log('PASS: symmetric middle-button movement, neutral zone and click cancellation');
{
 const f=fixture();let wheelCalls=0,cancelled=0;f.grid.dragWheel=()=>wheelCalls++;f.grid.stopDrag=()=>cancelled++;
 f.wheel();assert.equal(wheelCalls,1);f.root.events.pointerleave({clientY:701});assert.equal(f.frames.size,0,'wheel cannot start another controller during an active range drag');
 f.document.hidden=true;f.document.events.visibilitychange();assert.equal(cancelled,1);assert.equal(f.frames.size,0);
}
console.log('PASS: one controller during drag, hidden-page cleanup and scroll-boundary stop');

function roundedMiddle(){const f=fixture();let top=2000;f.scroll.scrollHeight=6000;Object.defineProperty(f.scroll,'scrollTop',{get:()=>top,set:value=>{top=Math.max(0,Math.min(5400,Math.round(value)))}});f.click(1);f.document.events.pointermove({clientY:263});return f;}
{
 const f=roundedMiddle();f.tick(0);const before=f.scroll.scrollTop;for(let i=1;i<=60;i++)f.tick(i*1000/60);assert.equal(f.scroll.scrollTop-before,8,'13px middle displacement must accumulate 8px/s despite integer scroll offsets');assert.equal(f.frames.size,1,'a rounded zero-motion frame is not the scroll boundary');f.grid.stopContinuousScroll();
}
{
 const f=roundedMiddle();f.tick(0);f.tick(16);f.tick(32);const before=f.scroll.scrollTop;f.document.events.pointermove({clientY:237});for(let t=48;t<=96;t+=16)f.tick(t);assert.equal(f.scroll.scrollTop,before-1,'reversal discards the old direction fractional carry');f.grid.stopContinuousScroll();
}
{
 const f=roundedMiddle();f.scroll.scrollTop=5400;f.tick(0);f.tick(16);assert.equal(f.frames.size,0,'positive scrolling stops at the actual maximum extent');
}
console.log('PASS: low-speed middle scrolling survives rounded offsets, resets on reversal and stops only at real bounds');
