(function(root){'use strict';
const minimums={order_id:90,quantity:54,earning:75,purchase_id:100,supplier:80,note:55,platform:130,tracking:75,secondary_tracking:85,status:140,product_cost:75,shipping_cost:75,additional_cost:75,gross:80,margin:75,id:100,date:125};
function allocate(columns,preferences,required,available){
 const floors=columns.map(c=>Math.max(minimums[c.key]||55,required[c.key]||0));
 const values=columns.map((c,i)=>Math.max(floors[i],Math.min(1200,Number(preferences[c.key])||c.width)));
 if(!available)return Object.fromEntries(columns.map((c,i)=>[c.key,values[i]]));
 let excess=values.reduce((a,b)=>a+b,45)-available;
 for(const key of ['note','supplier','secondary_tracking','quantity']){const i=columns.findIndex(c=>c.key===key);if(i<0||excess<=0)continue;const take=Math.min(excess,values[i]-floors[i]);values[i]-=take;excess-=take;}
 if(excess>0){const capacity=values.reduce((n,v,i)=>n+v-floors[i],0),ratio=capacity?Math.min(1,excess/capacity):0;values.forEach((v,i)=>values[i]=v-(v-floors[i])*ratio);}
 const extra=available-values.reduce((a,b)=>a+b,45);if(extra>0){const total=values.reduce((a,b)=>a+b,0);values.forEach((v,i)=>values[i]+=extra*v/total);}
 return Object.fromEntries(columns.map((c,i)=>[c.key,values[i]]));
}
const api={allocate,minimums};root.SheetSizing=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
