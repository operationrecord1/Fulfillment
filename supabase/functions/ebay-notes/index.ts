import {readNotes,writeNote} from './provider.mjs';
import {refreshAccess} from '../ebay-sync/provider.mjs';
const base=Deno.env.get('SUPABASE_URL')!;
const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const key=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
async function rpc(name:string,body:unknown={}){
 const r=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Note Storage Unavailable');return r.json();
}
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return new Response('Method Not Allowed',{status:405});
 const candidate=req.headers.get('x-fulfillment-webhook-secret');
 if(!candidate||!await rpc('verify_fulfillment_webhook',{candidate}))return new Response('Unauthorized',{status:401});
 let completed=0;const started=Date.now();
 while(Date.now()-started<45000){
  const job=await rpc('ebay_note_worker',{action:'claim'});if(!job)break;
  const identity={store_id:job.store_id,lease_id:job.lease_id};
  const work=(action:string,values={})=>rpc('ebay_note_worker',{action,payload:{...identity,...values}});
  try{
   let token=job.tokens.access_token;
   if(Date.parse(job.access_expires_at)<=Date.now()+60000){
    const config=await rpc('ebay_connection_worker',{action:'credentials'});
    const fresh=await refreshAccess(config,job.tokens.refresh_token);await work('token',{tokens:fresh});token=fresh.access_token;
   }
   for(const note of job.outbox){
    try{await writeNote(note.line_ids,note.note,token);await work('sent',{order_id:note.order_id,version:note.version});}
    catch(e){await work('outbox_error',{order_id:note.order_id,version:note.version,error:e.message});}
   }
   const started_at=new Date().toISOString(),notes=await readNotes(token);
   await work('import',{notes,started_at});await work('finish');completed++;
  }catch(e){await work('fail',{error:e.message||'eBay Note Sync Unavailable'});}
 }
 return Response.json({completed},{headers:{'Cache-Control':'no-store'}});
});
