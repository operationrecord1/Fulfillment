const test=require('node:test');
const assert=require('node:assert/strict');
const Insights=require('./dashboard-insights.js');

class Events{
 constructor(){this.listeners=new Map();}
 addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(listener);}
 removeEventListener(type,listener){this.listeners.get(type)?.delete(listener);}
 emit(type,event={}){for(const listener of [...(this.listeners.get(type)||[])])listener({type,target:this,...event});}
}
const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height,x:left,y:top});

function fixture({width=2500,height=900,contentWidth=430,contentHeight=180,bounded=true}={}){
 const saved={};
 for(const key of ['window','document','requestAnimationFrame','cancelAnimationFrame','ResizeObserver'])saved[key]=Object.getOwnPropertyDescriptor(global,key);
 const frames=new Map(),observers=[];let nextFrame=0,opened=false;
 const win=new Events();win.innerWidth=width;win.innerHeight=height;
 const viewport=new Events();viewport.offsetLeft=0;viewport.offsetTop=0;viewport.fixedWidth=null;viewport.fixedHeight=null;
 Object.defineProperties(viewport,{width:{get:()=>viewport.fixedWidth??win.innerWidth},height:{get:()=>viewport.fixedHeight??win.innerHeight}});
 win.visualViewport=viewport;
 win.requestAnimationFrame=fn=>{const id=++nextFrame;frames.set(id,fn);return id;};
 win.cancelAnimationFrame=id=>frames.delete(id);
 win.ResizeObserver=class{
  constructor(callback){this.callback=callback;this.targets=new Set();observers.push(this);}
  observe(target){this.targets.add(target);}
  unobserve(target){this.targets.delete(target);}
  disconnect(){this.targets.clear();}
 };
 class Element extends Events{
  constructor(parent=null){super();this.parentElement=parent;this.children=[];this.style={};this.attributes={};this.visible=true;this.connected=true;this.nodeType=1;if(parent)parent.children.push(this);}
  get isConnected(){return this.connected&&(!this.parentElement||this.parentElement.isConnected);}
  set isConnected(value){this.connected=value;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  append(child){child.parentElement=this;this.children.push(child);}
  contains(target){return target===this||this.children.some(child=>child.contains(target));}
  getClientRects(){return this.isConnected&&this.visible&&(!this.parentElement||this.parentElement.getClientRects().length)?[this.getBoundingClientRect()]:[];}
  getBoundingClientRect(){return this.rect||rect(0,0,win.innerWidth,win.innerHeight);}
  closest(selector){if(selector==='.om-kpi'&&this===card)return this;return this.parentElement?.closest(selector)||null;}
  focus(){}
  remove(){this.connected=false;this.removed=true;}
 }
 const host=new Element(),scroller=new Element(host),band=new Element(scroller),card=new Element(band),button=new Element(card);
 scroller.rect=rect(0,40,width,height-40);scroller.clientLeft=0;scroller.clientTop=0;scroller.clientWidth=width-15;scroller.clientHeight=height-40;
 band.rect=rect(12,80,2200,220);card.rect=rect(12,190,300,100);button.rect=rect(24,202,24,24);
 const pop=new Element(),closeButton=new Element(pop);
 pop.matches=selector=>selector===':popover-open'&&opened;
 pop.showPopover=()=>{opened=true;pop.emit('beforetoggle',{newState:'open'});};
 pop.hidePopover=()=>{pop.emit('beforetoggle',{newState:'closed'});opened=false;};
 pop.querySelector=selector=>selector==='button'?closeButton:null;
 pop.contentWidth=contentWidth;pop.contentHeight=contentHeight;
 Object.defineProperties(pop,{
  offsetWidth:{get:()=>Math.max(0,parseFloat(pop.style.width)||300)},
  clientWidth:{get:()=>Math.max(0,pop.offsetWidth-2)},
  scrollWidth:{get:()=>Math.max(pop.clientWidth,pop.contentWidth)},
  offsetHeight:{get:()=>Math.min(pop.contentHeight,parseFloat(pop.style.maxHeight)||Infinity)},
  scrollHeight:{get:()=>pop.contentHeight}
 });
 pop.getBoundingClientRect=()=>rect(parseFloat(pop.style.left)||0,parseFloat(pop.style.top)||0,pop.offsetWidth,pop.offsetHeight);
 const doc=new Events();doc.createElement=()=>pop;doc.documentElement={};
 Object.defineProperties(doc.documentElement,{clientWidth:{get:()=>win.innerWidth},clientHeight:{get:()=>win.innerHeight}});
 global.window=win;global.document=doc;global.requestAnimationFrame=win.requestAnimationFrame;global.cancelAnimationFrame=win.cancelAnimationFrame;global.ResizeObserver=win.ResizeObserver;
 const api=Insights.bind(host,bounded?{bounds:band,scroller}:undefined);
 const flush=()=>{let passes=0;while(frames.size){assert.ok(++passes<=10,'positioning must settle without a perpetual animation loop');const queued=[...frames.values()];frames.clear();queued.forEach(fn=>fn(passes*16));}};
 const notifyLayout=()=>{for(const observer of observers)if(observer.targets.size)observer.callback([...observer.targets].map(target=>({target,contentRect:target.getBoundingClientRect()})),observer);};
 const resize=(nextWidth,nextHeight=win.innerHeight)=>{win.innerWidth=nextWidth;win.innerHeight=nextHeight;scroller.rect=rect(0,40,nextWidth,nextHeight-40);scroller.clientWidth=nextWidth-15;scroller.clientHeight=nextHeight-40;win.emit('resize');};
 const open=()=>{api.open(button,'Total Orders','42','<dl class="om-detail-pairs"><div><dt>January 2026</dt><dd>42</dd></div></dl>');flush();};
 return {win,viewport,host,scroller,band,card,button,pop,api,frames,observers,flush,notifyLayout,resize,open,get opened(){return opened;},
  restore(){api.destroy();for(const [key,descriptor] of Object.entries(saved)){if(descriptor)Object.defineProperty(global,key,descriptor);else delete global[key];}}
 };
}

function contained(pop,{left,right,top,bottom}){
 const r=pop.getBoundingClientRect();
 if(left!==undefined)assert.ok(r.left>=left-0.01,`left ${r.left} must stay within ${left}`);
 if(right!==undefined)assert.ok(r.right<=right+0.01,`right ${r.right} must stay within ${right}`);
 if(top!==undefined)assert.ok(r.top>=top-0.01,`top ${r.top} must stay within ${top}`);
 if(bottom!==undefined)assert.ok(r.bottom<=bottom+0.01,`bottom ${r.bottom} must stay within ${bottom}`);
}

test('Orders popups expand right from first cards and left from last cards within the KPI band',()=>{
 const f=fixture();try{
  f.open();assert.ok(f.pop.offsetWidth>f.card.rect.width);assert.equal(parseFloat(f.pop.style.left),f.card.rect.left);
  contained(f.pop,{left:12,right:2212,top:8,bottom:892});
  f.api.close();f.card.rect=rect(1912,190,300,100);f.open();
  assert.equal(f.pop.getBoundingClientRect().right,f.card.rect.right);
  contained(f.pop,{left:12,right:2212,top:8,bottom:892});
 }finally{f.restore();}
});

test('a late KPI layout update after 1100 to 2500 resize reanchors the open popup',()=>{
 const f=fixture({width:1100});try{
  f.band.rect=rect(12,80,2000,220);f.open();
  f.resize(2500);f.flush();
  f.band.rect=rect(150,80,2200,220);f.card.rect=rect(150,190,363,100);
  f.notifyLayout();f.flush();
  assert.equal(f.opened,true);assert.equal(parseFloat(f.pop.style.left),150);
  assert.ok(f.pop.offsetWidth>=363);
  contained(f.pop,{left:150,right:2350,top:8,bottom:892});
 }finally{f.restore();}
});

test('large yearly popups stay bounded when shrinking through desktop and mobile sizes',()=>{
 const f=fixture({contentHeight:1400});try{
  f.open();contained(f.pop,{left:12,right:2212,top:8,bottom:892});
  f.resize(1100,700);f.band.rect=rect(12,80,2000,220);f.card.rect=rect(12,190,330,100);f.notifyLayout();f.flush();
  contained(f.pop,{left:12,right:1085,top:8,bottom:692});
  f.resize(390,640);f.band.rect=rect(12,80,1100,220);f.card.rect=rect(12,190,181,100);f.notifyLayout();f.flush();
  assert.equal(f.opened,true);assert.equal(parseFloat(f.pop.style.left),12);
  assert.equal(f.pop.getBoundingClientRect().right,375);
  contained(f.pop,{left:12,right:375,top:16,bottom:624});
  f.viewport.offsetTop=60;f.viewport.fixedHeight=420;f.viewport.emit('resize');f.flush();
  contained(f.pop,{left:12,right:375,top:76,bottom:464});
 }finally{f.restore();}
});

test('Orders popup follows visible card scrolling and ignores scrolling inside its own content',()=>{
 const f=fixture({width:1100});try{
  f.band.rect=rect(0,80,2000,220);f.card.rect=rect(300,190,300,100);f.open();
  f.band.rect=rect(-200,80,2000,220);f.card.rect=rect(100,190,300,100);
  f.win.emit('scroll',{target:f.scroller});f.flush();
  assert.equal(f.opened,true);assert.equal(parseFloat(f.pop.style.left),100);
  f.win.emit('scroll',{target:f.pop});f.flush();assert.equal(f.opened,true);
 }finally{f.restore();}
});

test('a popup closes when its card becomes hidden, disconnected or outside the visible region',()=>{
 const f=fixture({width:1100});try{
  f.band.rect=rect(12,80,2000,220);f.open();
  f.card.visible=false;f.win.emit('resize');f.flush();assert.equal(f.opened,false);
  f.card.visible=true;f.open();f.card.isConnected=false;f.win.emit('resize');f.flush();assert.equal(f.opened,false);
  f.card.isConnected=true;f.open();f.card.rect=rect(1500,190,300,100);f.win.emit('resize');f.flush();assert.equal(f.opened,false);
 }finally{f.restore();}
});

test('close and destroy clean observers and scheduled work; reopening uses fresh geometry',()=>{
 const f=fixture();try{
  f.open();assert.ok(f.observers.some(observer=>observer.targets.has(f.card)));
  f.win.emit('resize');assert.ok(f.frames.size>0);
  f.api.close();assert.equal(f.frames.size,0);assert.ok(f.observers.every(observer=>observer.targets.size===0));
  assert.equal(f.button.getAttribute('aria-expanded'),'false');
  f.card.rect=rect(1912,190,300,100);f.open();assert.equal(f.pop.getBoundingClientRect().right,2212);
  f.win.emit('resize');f.api.destroy();assert.equal(f.frames.size,0);assert.ok(f.observers.every(observer=>observer.targets.size===0));
  f.win.emit('resize');f.viewport.emit('resize');f.notifyLayout();f.flush();
  assert.equal(f.opened,false);assert.equal(f.pop.removed,true);
 }finally{f.restore();}
});

test('default non-Orders binding retains viewport positioning and closes on host scrolling',()=>{
 const f=fixture({width:1100,bounded:false});try{
  f.card.rect=rect(700,190,300,100);f.open();
  assert.equal(f.pop.getBoundingClientRect().right,1092);
  assert.equal(f.observers.some(observer=>observer.targets.size),false);
  f.host.emit('scroll',{target:f.scroller});assert.equal(f.opened,false);
 }finally{f.restore();}
});
