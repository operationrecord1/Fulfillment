import {readCatalog,readMissingImages} from './catalog.mjs';
import {refreshAccess,readPage,ProviderError} from './provider.mjs';
import {XMLParser} from 'npm:fast-xml-parser@4.5.3';
import {readDelivery} from './delivery.mjs';
const catalogParser=new XMLParser({ignoreAttributes:true,removeNSPrefix:true,parseTagValue:false,processEntities:true});
const deliveryParser=new XMLParser({ignoreAttributes:true,removeNSPrefix:true,parseTagValue:false,processEntities:false});
const base=Deno.env.get('SUPABASE_URL')!;
const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const key=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
async function rpc(name:string,body:unknown){
 const r=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 if(!r.ok){const error=await r.json().catch(()=>({}));throw new ProviderError('Sync storage: '+String(error.message||r.status).slice(0,120));}return r.json();
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
  const lane=async()=>{let attempts=0;while(Date.now()-started<45000&&attempts++<16){
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
    const read=()=>job.resource==='listings'?readCatalog(job,token,fetch,xml=>catalogParser.parse(xml)):job.resource==='delivery_tracking'?readDelivery(job,token,fetch,xml=>deliveryParser.parse(xml)):readPage(job,token);
    try{page=await read();}catch(e){if(e instanceof ProviderError&&e.status===401&&!refreshed){await renew();page=await read();}else throw e;}
    await work('commit',{...identity,...page});completed++;
    if(job.resource==='orders'&&job.image_ids?.length){try{const images=await readMissingImages(job,token,fetch,xml=>catalogParser.parse(xml));await rpc('ebay_catalog_images_commit',{target:job.store_id,records:images,attempted:job.image_ids});}catch(e){console.warn('Image recovery delayed');}}
   }catch(e){
    const known=e instanceof ProviderError;
    await work('fail',{...identity,error:known?e.message:'Temporary sync failure; saved data retained',retry_after:known?e.retryAfter:60});failed++;
   }
  }
  };await Promise.all([lane(),lane(),lane()]);
  return Response.json({completed,failed},{headers:{'Cache-Control':'no-store'}});
 }catch{return new Response('Background sync unavailable',{status:503});}
});
