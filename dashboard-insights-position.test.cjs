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

function fixture({width=2500,height=900,contentWidth=430,contentHeight=180,rowsWidth=340,scrollbarWidth=0,bounded=true}={}){
 const saved={};
 for(const key of ['window','document','requestAnimationFrame','cancelAnimationFrame','ResizeObserver'])saved[key]=Object.getOwnPropertyDescriptor(global,key);
 const frames=new Map(),observers=[];let nextFrame=0,opened=false,shows=0,hides=0;
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
  focus(){doc.activeElement=this;}
  remove(){this.connected=false;this.removed=true;}
 }
 const host=new Element(),scroller=new Element(host),band=new Element(scroller),card=new Element(band),button=new Element(card);
 scroller.rect=rect(0,40,width,height-40);scroller.clientLeft=0;scroller.clientTop=0;scroller.clientWidth=width-15;scroller.clientHeight=height-40;
 band.rect=rect(12,80,2200,220);card.rect=rect(12,190,300,100);button.rect=rect(24,202,24,24);
 const pop=new Element();let closeButton=new Element(pop),pairs=null,label=null,value=null,heading=null,headingValue=null,markup='';
 const padding=()=>win.innerWidth<600?14:12;
 const fontSize=element=>element.style.fontSize||((element===headingValue)?'21px':element.parentElement?fontSize(element.parentElement):'13px');
 win.getComputedStyle=element=>({fontSize:fontSize(element),paddingLeft:padding()+'px',paddingRight:padding()+'px'});
 pop.fontWrites=[];pop.rowsWidth=rowsWidth;
 Object.defineProperty(pop,'innerHTML',{get:()=>markup,set:html=>{
  if(pop.contains(doc.activeElement))doc.activeElement=null;
  markup=html;pop.children=[];closeButton=new Element(pop);heading=new Element(pop);headingValue=new Element(heading);
  pairs=html.includes('om-detail-pairs')?new Element(pop):null;
  if(pairs){
   let size='';Object.defineProperty(pairs.style,'fontSize',{get:()=>size,set:next=>{size=next;pop.fontWrites.push(next);}});
   label=new Element(pairs);value=new Element(pairs);pairs.scrollLeft=0;
   Object.defineProperties(pairs,{
    clientWidth:{get:()=>Math.max(0,pop.clientWidth-padding()*2)},
    scrollWidth:{get:()=>Math.max(pairs.clientWidth,Math.ceil((pop.rowsWidth-8)*parseFloat(fontSize(pairs))/13+8))}
   });
  }
 }});
 pop.matches=selector=>selector===':popover-open'&&opened;
 pop.showPopover=()=>{shows++;opened=true;pop.emit('beforetoggle',{newState:'open'});};
 pop.hidePopover=()=>{hides++;pop.emit('beforetoggle',{newState:'closed'});opened=false;};
 pop.querySelector=selector=>selector==='button'?closeButton:selector==='.om-detail-pairs'?pairs:null;
 pop.contentWidth=contentWidth;pop.contentHeight=contentHeight;
 Object.defineProperties(pop,{
  offsetWidth:{get:()=>Math.max(0,parseFloat(pop.style.width)||300)},
  clientWidth:{get:()=>Math.max(0,pop.offsetWidth-2-(pop.contentHeight>(parseFloat(pop.style.maxHeight)||Infinity)?scrollbarWidth:0))},
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
 const open=(options)=>{api.open(button,'Total Orders','42','<dl class="om-detail-pairs"><div><dt>January 2026</dt><dd>42</dd></div></dl>',options);flush();};
 return {win,viewport,host,scroller,band,card,button,pop,api,frames,observers,flush,notifyLayout,resize,open,doc,
  get opened(){return opened;},get shows(){return shows;},get hides(){return hides;},get pairs(){return pairs;},get closeButton(){return closeButton;},get label(){return label;},get value(){return value;},get heading(){return heading;},get headingValue(){return headingValue;},
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

const financeOptions={compactRows:true,anchorTop:true};
const financeBody='<dl class="om-detail-pairs"><div><dt>Orders Awaiting Buying Price</dt><dd>42</dd></div></dl>';

test('finance popups stay at the card top on desktop and mobile and scroll below it',()=>{
 const f=fixture({contentHeight:600,scrollbarWidth:15});try{
  f.open(financeOptions);
  assert.equal(parseFloat(f.pop.style.top),190);
  assert.equal(parseFloat(f.pop.style.maxHeight),702);
  f.resize(390,640);f.band.rect=rect(12,80,1100,220);f.card.rect=rect(12,430,181,100);f.notifyLayout();f.flush();
  assert.equal(parseFloat(f.pop.style.top),430);
  assert.equal(parseFloat(f.pop.style.maxHeight),194);
  contained(f.pop,{left:12,right:375,top:430,bottom:624});
  assert.ok(f.pop.scrollHeight>f.pop.offsetHeight,'tall details scroll rather than moving above the card');
  f.viewport.offsetTop=30;f.viewport.fixedHeight=540;f.viewport.emit('resize');f.flush();
  assert.equal(parseFloat(f.pop.style.top),430);
  contained(f.pop,{left:12,right:375,top:430,bottom:554});
 }finally{f.restore();}
});

test('finance rows expand only to required width, then shrink labels and values together one pixel at a time',()=>{
 const f=fixture({rowsWidth:340});try{
  f.open(financeOptions);
  assert.equal(f.pop.offsetWidth,366,'natural rows plus 24px padding and 2px borders');
  assert.equal(parseFloat(f.pop.style.left),12);
  assert.equal(f.pairs.style.fontSize,'','wide layout keeps original body font');
  f.resize(350,640);f.band.rect=rect(12,80,1100,220);f.card.rect=rect(12,190,180,100);f.pop.fontWrites=[];f.notifyLayout();f.flush();
  assert.equal(f.pop.offsetWidth,323);
  assert.deepEqual(f.pop.fontWrites,['','12px','11px']);
  assert.equal(f.win.getComputedStyle(f.label).fontSize,'11px');
  assert.equal(f.win.getComputedStyle(f.value).fontSize,'11px');
  assert.equal(f.win.getComputedStyle(f.heading).fontSize,'13px');
  assert.equal(f.win.getComputedStyle(f.headingValue).fontSize,'21px');
  assert.ok(f.pairs.scrollWidth<=f.pairs.clientWidth+1);
  f.resize(2500);f.band.rect=rect(150,80,2200,220);f.card.rect=rect(150,190,300,100);f.notifyLayout();f.flush();
  assert.equal(f.pairs.style.fontSize,'','restoring width restores normal text size');
  assert.equal(f.pop.offsetWidth,366);
  assert.equal(parseFloat(f.pop.style.left),150);
 }finally{f.restore();}
});

test('finance width includes vertical scrollbar space and falls back to body scrolling at the readable floor',()=>{
 const f=fixture({width:390,height:640,contentHeight:600,rowsWidth:310,scrollbarWidth:15});try{
  f.band.rect=rect(12,80,1100,220);f.card.rect=rect(12,190,180,100);f.open(financeOptions);
  assert.equal(f.pop.offsetWidth,355,'measured rows include popup padding, border and scrollbar');
  assert.equal(f.pairs.style.fontSize,'');assert.ok(f.pairs.scrollWidth<=f.pairs.clientWidth+1);
  f.resize(220);f.notifyLayout();f.flush();
  assert.equal(f.pairs.style.fontSize,'11px');
  assert.ok(f.pairs.scrollWidth>f.pairs.clientWidth,'extreme widths retain unbroken text with horizontal body scrolling');
  contained(f.pop,{left:12,right:205,top:190,bottom:624});
 }finally{f.restore();}
});

test('live finance refresh retains the open anchor, focus and scrolling while updating values and geometry',()=>{
 const f=fixture({width:390,height:640,contentHeight:700});try{
  f.band.rect=rect(12,80,1100,220);f.card.rect=rect(12,190,180,100);f.open(financeOptions);
  const firstClose=f.closeButton,shows=f.shows,hides=f.hides;
  f.pop.scrollTop=96;f.pairs.scrollLeft=20;f.pop.rowsWidth=420;
  assert.equal(f.api.update(f.button,'Product Cost','$1,042.00',financeBody),true);f.flush();
  assert.equal(f.opened,true);assert.equal(f.shows,shows);assert.equal(f.hides,hides);
  assert.match(f.pop.innerHTML,/Product Cost/);assert.match(f.pop.innerHTML,/\$1,042\.00/);assert.match(f.pop.innerHTML,/Orders Awaiting Buying Price/);
  assert.notEqual(f.closeButton,firstClose);assert.equal(f.doc.activeElement,f.closeButton);
  assert.equal(f.pop.scrollTop,96);assert.equal(f.pairs.scrollLeft,20);
  assert.equal(f.button.getAttribute('aria-expanded'),'true');
  assert.equal(parseFloat(f.pop.style.top),190);assert.equal(f.pairs.style.fontSize,'11px');
  f.button.focus();f.api.update(f.button,'Product Cost','$1,043.00',financeBody);f.flush();
  assert.equal(f.doc.activeElement,f.button,'a refresh must not steal outside focus');
  const html=f.pop.innerHTML;
  assert.equal(f.api.update({},'Other','0','ignored'),false);assert.equal(f.pop.innerHTML,html);
  f.api.close();assert.equal(f.api.update(f.button,'Other','0','ignored'),false);assert.equal(f.opened,false);
 }finally{f.restore();}
});

test('finance presentation options do not leak when switching to another metric',()=>{
 const f=fixture({width:390,height:640});try{
  f.band.rect=rect(12,80,1100,220);f.card.rect=rect(12,190,180,100);f.open(financeOptions);
  assert.match(f.pop.className,/om-orders-finance-details/);
  f.api.close();f.open();
  assert.doesNotMatch(f.pop.className,/om-orders-finance-details/);
  assert.equal(parseFloat(f.pop.style.top),(640-f.pop.offsetHeight)/2,'other metrics keep existing mobile centering');
 }finally{f.restore();}
});
