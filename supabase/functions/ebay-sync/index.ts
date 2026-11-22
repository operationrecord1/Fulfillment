import {refreshAccess,readPage,ProviderError} from './provider.mjs';
const base=Deno.env.get('SUPABASE_URL')!;
const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const key=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
async function rpc(name:string,body:unknown){
 const r=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Sync storage unavailable');return r.json();
}
const work=(action:string,payload:unknown={})=>rpc('ebay_sync_worker',{action,payload});
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 try{
  const candidate=req.headers.get('x-fulfillment-webhook-secret');
  if(!candidate||!await rpc('verify_fulfillment_webhook',{candidate}))return new Response('Unauthorized',{status:401});
  const config=await rpc('ebay_connection_worker',{action:'credentials',payload:{}});
  const started=Date.now();let completed=0,failed=0;
  // Bounded work keeps each invocation inside the edge lifetime. Jobs resume from durable cursors.
  while(Date.now()-started<45000&&completed+failed<32){
   const job=await work('claim');if(!job)break;
   const identity={store_id:job.store_id,resource:job.resource,lease_id:job.lease_id};
   try{
    let token=job.tokens.access_token,refreshed=false;
    const renew=async()=>{
     if(Date.parse(job.refresh_expires_at)<=Date.now())throw new ProviderError('Reconnect required: eBay authorization expired',401,21600);
     const fresh=await refreshAccess(config,job.tokens.refresh_token);
     await work('token',{...identity,tokens:fresh});token=fresh.access_token;refreshed=true;
    };
    if(Date.parse(job.access_expires_at)<=Date.now()+60000)await renew();
    let page;
    try{page=await readPage(job,token);}catch(e){if(e instanceof ProviderError&&e.status===401&&!refreshed){await renew();page=await readPage(job,token);}else throw e;}
    await work('commit',{...identity,...page});completed++;
   }catch(e){
    const known=e instanceof ProviderError;
    await work('fail',{...identity,error:known?e.message:'Temporary sync failure; saved data retained',retry_after:known?e.retryAfter:60});failed++;
   }
  }
  return Response.json({completed,failed},{headers:{'Cache-Control':'no-store'}});
 }catch{return new Response('Background sync unavailable',{status:503});}
});
