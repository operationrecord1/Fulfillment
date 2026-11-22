(function(){
 'use strict';
 if(new URLSearchParams(location.search).get('measure')!=='1')return;
 const write=(kind,data)=>console.info('[workspace-speed] '+JSON.stringify({kind,...data}));
 for(const type of ['event','longtask']){try{new PerformanceObserver(list=>{for(const e of list.getEntries()){if(type==='event'&&!e.interactionId)continue;write(type,{name:e.name,duration:Math.round(e.duration),inputDelay:type==='event'?Math.round(e.processingStart-e.startTime):undefined,processing:type==='event'?Math.round(e.processingEnd-e.processingStart):undefined,target:type==='event'?(e.target?.closest('button,a')?.getAttribute('aria-label')||e.target?.closest('a')?.getAttribute('href')||e.target?.id||e.target?.tagName):undefined});}}).observe({type,buffered:true,durationThreshold:16});}catch{}}
 try{new PerformanceObserver(list=>{for(const e of list.getEntries())write('frame',{duration:Math.round(e.duration),render:Math.round(e.startTime+e.duration-e.renderStart),scripts:e.scripts.map(s=>({name:s.sourceFunctionName,invoker:s.invoker,duration:Math.round(s.duration),layout:Math.round(s.forcedStyleAndLayoutDuration),url:s.sourceURL?.split('/').pop(),position:s.sourceCharPosition}))});}).observe({type:'long-animation-frame',buffered:true});}catch{}
 window.WorkspaceSpeed={measure(name,fn){const t=performance.now();try{return fn();}finally{write('work',{name,duration:Math.round((performance.now()-t)*10)/10});}}};
})();
