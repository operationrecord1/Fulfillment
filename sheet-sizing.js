(function(root){'use strict';
const rowNumberWidth=33;
const referenceWidths={order_id:146,quantity:70,earning:135,purchase_id:146,supplier:131,note:169,platform:131,tracking:105,secondary_tracking:140,status:136,product_cost:101,shipping_cost:101,additional_cost:101,gross:101,margin:101,id:122,date:95};
const minimums={order_id:78,quantity:68,earning:65,purchase_id:78,supplier:83,note:38,platform:70,tracking:68,secondary_tracking:82,status:65,product_cost:66,shipping_cost:73,additional_cost:82,gross:49,margin:59,id:60,date:95};
const weights={note:1.2,product_cost:1.4,shipping_cost:1.4,additional_cost:1.4,gross:1.4,margin:1.4};
function allocate(columns,preferences,required,available){
 const floors=columns.map(c=>Math.max(minimums[c.key]||55,required[c.key]||0));
 const values=columns.map((c,i)=>Math.max(floors[i],Number(preferences[c.key])||(c.type==='select'?floors[i]:(referenceWidths[c.key]||c.width))));
 if(columns.length===15&&!columns.some(c=>c.key==='purchase_id')){for(const [i,c] of columns.entries())if(['order_id','note','tracking','secondary_tracking'].includes(c.key))values[i]+=referenceWidths.purchase_id/4;}
 if(columns.length===15&&!columns.some(c=>c.key==='platform')){for(const [i,c] of columns.entries())if(['tracking','earning','supplier'].includes(c.key))values[i]+=referenceWidths.platform/3;}
 if(available){const target=available-rowNumberWidth,total=values.reduce((a,b)=>a+b,0);
  if(total>target){let lo=0,hi=1;for(let n=0;n<50;n++){const mid=(lo+hi)/2,sum=values.reduce((s,v,i)=>s+Math.max(floors[i],v*(1-mid*(weights[columns[i].key]||1))),0);if(sum>target)lo=mid;else hi=mid;}values.forEach((v,i)=>values[i]=Math.max(floors[i],v*(1-hi*(weights[columns[i].key]||1))));}
  else if(total<target){const flexible=columns.map((c,i)=>c.type!=='select'?i:-1).filter(i=>i>=0),sum=flexible.reduce((s,i)=>s+values[i],0);for(const i of flexible)values[i]+=(target-total)*values[i]/sum;}
 }
 return Object.fromEntries(columns.map((c,i)=>[c.key,values[i]]));
}
const api={allocate,minimums,referenceWidths,rowNumberWidth,weights};root.SheetSizing=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
