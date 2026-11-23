(function(root){'use strict';
function create({revision,refresh,now=Date.now}){
 let busy=false,disposed=false,last=null,unchanged=0,next=0,lastFull=0;
 return {async tick(){
  if(disposed||busy||now()<next)return;busy=true;
  try{
   const version=await revision();if(disposed)return;
   if(version!==last||now()-lastFull>=300000){
    if(await refresh()===false)throw Error('Refresh failed');
    last=version;lastFull=now();unchanged=0;
   }else unchanged++;
   next=now()+Math.min(60000,15000*2**Math.floor(unchanged/2));
  }catch{next=now()+60000;}finally{busy=false;}
 },dispose(){disposed=true;}};
}
root.CommerceRefresh={create};if(typeof module!=='undefined')module.exports={create};
})(typeof window==='undefined'?globalThis:window);
