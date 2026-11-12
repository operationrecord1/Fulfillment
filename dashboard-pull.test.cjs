const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const s=fs.readFileSync('dashboard.js','utf8');const events={};let reloads=0;
const hint={hidden:true,setAttribute(){}},viewport={scrollTop:0,getBoundingClientRect:()=>({top:40})};
const host={querySelector:()=>({append(){}}),addEventListener:(name,fn)=>events[name]=fn};
const context={AbortController,document:{createElement:()=>hint},host,viewport,window:{innerWidth:390},grid:{editor:null},$:()=>({open:false}),location:{reload:()=>reloads++},flush:async()=>true,feedback(){},setTimeout};
vm.runInNewContext(s.slice(s.indexOf('const pullEvents='),s.indexOf('const poll=')),context);
const event=(x,y)=>({touches:[{clientX:x,clientY:y}],target:{closest:()=>null},preventDefault(){}});
(async()=>{
events.touchstart(event(30,350));events.touchmove(event(30,440));assert.equal(hint.textContent,'Release to refresh');await events.touchend();assert.equal(reloads,1);
events.touchstart(event(30,350));events.touchmove(event(30,390));await events.touchend();assert.equal(reloads,1);
events.touchstart(event(30,350));events.touchmove(event(90,450));await events.touchend();assert.equal(reloads,1);
viewport.scrollTop=10;events.touchstart(event(30,350));events.touchmove(event(30,450));await events.touchend();assert.equal(reloads,1);
console.log('PASS: pull refresh from any non-input area, threshold, horizontal cancellation and scroll-top guard');
})();
