const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const listeners=new Map(),frames=new Map();let seq=0;const context={window:{OrderCore:require('./dashboard-core'),SheetModel:require('./sheet-model'),addEventListener(k,f){listeners.set('window:'+k,f)},removeEventListener(k){listeners.delete('window:'+k)}},document:{elementFromPoint(){return null},addEventListener(k,f){listeners.set(k,f)},removeEventListener(k){listeners.delete(k)}},innerWidth:1000,innerHeight:700,requestAnimationFrame(f){frames.set(++seq,f);return seq},cancelAnimationFrame(id){frames.delete(id)}};vm.runInNewContext(fs.readFileSync('sheet-grid.js','utf8'),context);const g=Object.create(context.window.OrderSheetGrid.prototype);let ended=0,cancelled=0,updates=0,captured=false;
g.host={addEventListener(k,f){listeners.set(k,f)},removeEventListener(k){listeners.delete(k)},setPointerCapture(){captured=true},hasPointerCapture(){return captured},releasePointerCapture(){captured=false}};g.scroll={scrollTop:100,scrollLeft:100,getBoundingClientRect:()=>({top:20,bottom:650,left:0,right:900})};
const tick=t=>{const [id,fn]=frames.entries().next().value;frames.delete(id);fn(t)};
g.dragTrack({pointerId:1,clientX:100,clientY:200},p=>{updates++;assert(p.clientY<=647);assert(p.clientY>=22)},()=>ended++,()=>cancelled++);assert(captured);listeners.get('pointermove')({pointerId:1,clientX:100,clientY:900,buttons:1});tick(16);const first=g.scroll.scrollTop;tick(32);assert(g.scroll.scrollTop>first,'stationary outside pointer must keep scrolling');listeners.get('pointermove')({pointerId:1,clientX:100,clientY:-200,buttons:1});const before=g.scroll.scrollTop;tick(48);assert(g.scroll.scrollTop<before);listeners.get('pointerup')({pointerId:1});assert.equal(ended,1);assert.equal(frames.size,0);assert.equal(listeners.size,0);assert(!captured);
g.dragTrack({pointerId:2,clientX:100,clientY:200},()=>{},()=>ended++,()=>cancelled++);assert(!listeners.has('window:blur'));assert(!listeners.has('lostpointercapture'));listeners.get('pointercancel')({pointerId:2});assert.equal(cancelled,1);assert.equal(frames.size,0);assert.equal(listeners.size,0);console.log('PASS: continuous stationary/outside edge scroll, upward reversal, pointer capture, release/cancel cleanup; focus loss does not stop the loop');

// Outside browser events may omit the pressed-button mask. Keep the active
// gesture until release/cancel, or a zero-button move back inside the viewport.
g.dragTrack({pointerId:3,pointerType:'mouse',clientX:100,clientY:200},()=>{},()=>ended++,()=>cancelled++);
listeners.get('pointermove')({pointerId:3,clientX:100,clientY:699,buttons:1});
listeners.get('pointerout')({pointerId:3,clientX:100,clientY:700,relatedTarget:null});
listeners.get('pointermove')({pointerId:3,clientX:100,clientY:760,buttons:0});
const outsideStart=g.scroll.scrollTop;tick(100);tick(116);assert(g.scroll.scrollTop>outsideStart);assert(g.stopDrag);
listeners.get('window:mouseup')({button:0});assert.equal(ended,2);assert.equal(frames.size,0);assert.equal(listeners.size,0);
g.dragTrack({pointerId:4,clientX:100,clientY:200},()=>{},()=>ended++,()=>cancelled++);
listeners.get('pointermove')({pointerId:4,clientX:100,clientY:300,buttons:0});assert.equal(cancelled,2);assert.equal(frames.size,0);
console.log('PASS: outside zero-button events retain scrolling; mouse release fallback and released-pointer reentry stop it');

g.table={querySelectorAll:()=>[{getBoundingClientRect:()=>({bottom:150})}],querySelector:()=>({getBoundingClientRect:()=>({bottom:150})})};g.scroll.scrollTop=500;
g.dragTrack({pointerId:5,clientX:100,clientY:300},()=>{},()=>{},()=>{});
listeners.get('pointermove')({pointerId:5,clientX:100,clientY:120,buttons:1});tick(200);const sticky=g.scroll.scrollTop;tick(216);assert(g.scroll.scrollTop<sticky,'pointer over sticky header must continuously scroll upward');listeners.get('pointerup')({pointerId:5});console.log('PASS: upward scroll starts above visible rows, including sticky-header area');

// The thead scrolls away, while its th remains sticky. Hit-testing the
// non-sticky thead sends upward selection into the toolbar instead of a row.
g.table={querySelectorAll:()=>[{getBoundingClientRect:()=>({bottom:150})}],querySelector:selector=>({getBoundingClientRect:()=>({bottom:selector==='thead th'?150:-500})})};g.scroll.scrollTop=700;let endpointY=0;
g.dragTrack({pointerId:6,clientX:100,clientY:300},event=>{endpointY=event.clientY;assert(event.clientY>150,'upward selection must target below sticky column labels');},()=>{},()=>{});
listeners.get('pointermove')({pointerId:6,clientX:100,clientY:-50,buttons:1});tick(300);tick(316);assert(endpointY>150);listeners.get('pointerup')({pointerId:6});console.log('PASS: upward range endpoint hits visible body rows below sticky th, not scrolled-away thead');
