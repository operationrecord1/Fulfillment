import {refundEmail} from './template.mjs';
const base=Deno.env.get('SUPABASE_URL')!;
const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const service=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
async function rpc(name:string,body:unknown){const r=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Mail storage unavailable');return r.json();}
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 try{
  const candidate=req.headers.get('x-fulfillment-webhook-secret');
  if(!candidate||!await rpc('verify_fulfillment_webhook',{candidate}))return new Response('Unauthorized',{status:401});
  const key=Deno.env.get('BREVO_API_KEY');if(!key)return new Response('Email provider not configured',{status:503});
  const from=Deno.env.get('FULFILLMENT_FROM_EMAIL')||'no-reply@mail.fulfilment.site';
  let sent=0;const start=Date.now();
  for(let i=0;i<10&&Date.now()-start<40000;i++){
   const job=await rpc('due_refund_mail_worker',{action:'claim'});if(!job)break;if(job.skipped)continue;
   const identity={id:job.id,lease:job.lease};
   let response;
   try{response=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':key,'Content-Type':'application/json'},body:JSON.stringify({sender:{name:'Fulfilment',email:from.match(/<([^>]+)>/)?.[1]||from},to:[{email:job.email}],headers:{idempotencyKey:job.id},...refundEmail(job.payload)}),signal:AbortSignal.timeout(15000)});}catch{
    await rpc('due_refund_mail_worker',{action:'uncertain',payload:{...identity,error:'Provider response unavailable; verify delivery before retry'}});continue;
   }
   const result=await response.json().catch(()=>({}));
   const accepted=response.ok||result.code==='duplicate_parameter';
   await rpc('due_refund_mail_worker',{action:accepted?'sent':response.status===429?'retry':'uncertain',payload:{...identity,providerId:result.messageId||null,error:accepted?null:'Email provider HTTP '+response.status}});
   if(accepted)sent++;
  }
  return Response.json({sent});
 }catch{return new Response('Due Refund mail processing failed',{status:503});}
});
