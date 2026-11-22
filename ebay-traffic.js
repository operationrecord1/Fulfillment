(function(root){'use strict';
 function value(report,key){
  const index=report?.header?.metrics?.findIndex(x=>x.key===key),metric=index>=0?report.metricValues?.[index]:null;
  const raw=metric?.value;
  if(!metric||metric.applicable===false||raw===null||raw===undefined||raw===''||typeof raw==='boolean')return null;
  const n=Number(raw);return Number.isFinite(n)&&n>=0?n:null;
 }
 function day(raw){return /^\d{8}$/.test(raw||'')?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`:null;}
 function period(report){const from=day(report?.requestedFrom),to=day(report?.requestedTo);return from&&to?`${from} to ${to}`:'Reporting period unavailable';}
 const api={value,period};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EbayTraffic=api;
})(typeof window==='undefined'?globalThis:window);
