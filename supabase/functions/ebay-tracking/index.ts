import {inspectOrder,publishTracking,validateTracking,TrackingError} from './provider.mjs';
import {refreshAccess} from '../ebay-sync/provider.mjs';
const base=Deno.env.get('SUPABASE_URL')!;
const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const key=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const headers={'Access-Control-Allow-Origin':'https://fulfilment.site','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Cache-Control':'no-store'};
async function rpc(name:string,body:unknown){const r=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Order action could not be authorized or saved. Refresh and try again.');return r.json();}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return new Response('Method not allowed',{status:405,headers});
 const response=(d:unknown)=>Response.json(d,{headers});
 let work:any=null,attempt:string|null=null,mayHaveSent=false,accepted=false;
 try{
  const auth=req.headers.get('authorization')||'';
  const u=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:auth},signal:AbortSignal.timeout(10000)});
  if(!u.ok)return Response.json({error:'Sign in required'},{status:401,headers});
  const user=await u.json(),body=await req.json();
  if(!['read','check','submit','draft_save'].includes(body.action)||typeof body.order_id!=='string'||body.order_id.length>100)throw Error('Invalid order action');
  const identity={actor:user.id,store_id:body.store_id,order_id:body.order_id};
  work=(action:string,values={})=>rpc('ebay_tracking_worker',{action,payload:{...identity,...values}});
  const saved=await work('read');
  if(body.action==='read')return response(saved);
  if(body.action==='draft_save')return response(await work('draft_save',{kind:body.kind,body:body.message,revision:body.revision}));
  const context=await rpc('ebay_product_worker',{action:'context',payload:identity});let token=context.tokens.access_token;
  const renew=async()=>{const config=await rpc('ebay_connection_worker',{action:'credentials',payload:{}});const fresh=await refreshAccess(config,context.tokens.refresh_token);await rpc('ebay_product_worker',{action:'token',payload:{...identity,tokens:fresh}});token=fresh.access_token;};
  if(Date.parse(context.access_expires_at)<=Date.now()+60000)await renew();
  const inspect=async()=>{try{return await inspectOrder(body.order_id,token);}catch(e){if(e.status===401){await renew();return inspectOrder(body.order_id,token);}throw e;}};
  if(body.action==='check'){
   const live=await inspect();const current=await work('observed',{shipments:live.shipments});
   const pending=['unknown','confirmed'].includes(current.submission?.state)||(current.submission?.state==='checking'&&Date.parse(current.submission.updated_at)>Date.now()-120000);
   return response({...current,shipments:live.shipments,checked_at:live.checked_at,blocked:live.blocked||pending,reason:live.reason||(pending?'A previous submission is recorded or awaiting verification. Adding tracking is blocked.':'')});
  }
  const value=validateTracking(body.tracking,body.carrier);
  const claim=await work('claim',value);
  if(!claim.claimed)return response({...saved,blocked:true,error:'A submission already exists or is being verified. Check eBay status.',state:claim.state});
  attempt=claim.attempt_id;
  const live=await inspect();
  if(live.blocked){await work('transition',{attempt_id:attempt,state:'rejected',message:live.reason,shipments:live.shipments});return response({blocked:true,reason:live.reason,shipments:live.shipments,checked_at:live.checked_at});}
  // Persist uncertainty before the external write, so process crashes cannot cause a repeat POST.
  await work('transition',{attempt_id:attempt,state:'unknown',message:'Submission verification pending'});mayHaveSent=true;
  await publishTracking(body.order_id,live.order,value.tracking,value.carrier,token);accepted=true;
  const verified=await inspect();
  if(!verified.shipments.some(x=>x.tracking===value.tracking&&x.carrier.toLowerCase()===value.carrier.toLowerCase()))throw new TrackingError('eBay accepted the request; tracking confirmation is still pending.',0,true);
  const current=await work('transition',{attempt_id:attempt,state:'confirmed',message:'Tracking confirmed on eBay',shipments:verified.shipments});
  return response({...current,blocked:true,reason:'Tracking confirmed on eBay. Additional tracking is blocked.',shipments:verified.shipments,checked_at:verified.checked_at});
 }catch(e){
  const uncertain=mayHaveSent&&(accepted||!(e instanceof TrackingError)||e.uncertain||!e.status);
  if(work&&attempt&&!uncertain){try{await work('transition',{attempt_id:attempt,state:'rejected',message:e.message});}catch{}}
  return response({error:String(e.message||'Tracking action failed').slice(0,600),blocked:true,state:uncertain?'unknown':'error'});
 }
});
