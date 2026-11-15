import {backend,rpc} from './backend.ts';
import {googleClient,refreshGoogle} from './google.mjs';
import {mirror} from './engine.mjs';
import {verifyMirror} from './verify.mjs';
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 let claim:any;
 try{
  const candidate=req.headers.get('x-fulfillment-webhook-secret');
  if(!candidate||!await backend('/rest/v1/rpc/verify_fulfillment_webhook',{candidate}))return new Response('Unauthorized',{status:401});
  const input=await req.json().catch(()=>({}));
  if(input.action==='verify'){
   const snapshot=await rpc('snapshot',{employee_id:input.employee_id,year:input.year});
   return Response.json(await verifyMirror(snapshot,googleClient(await refreshGoogle(await rpc('credentials')))));
  }
  claim=await rpc('claim');if(!claim)return Response.json({idle:true});
  const credentials=await rpc('credentials'),google=googleClient(await refreshGoogle(credentials));
  const started=Date.now();let completed=0;
  while(claim&&Date.now()-started<80000){
   const result=await mirror(claim,{google,rpc,budgetMs:Math.max(5000,80000-(Date.now()-started))});
   claim=null;
   if(!result.complete)return Response.json({completed,pending:true});
   completed++;
   if(completed>=5||Date.now()-started>=70000)break;
   claim=await rpc('claim');
  }
  if(claim)await rpc('yield',{token:claim.token,employee_id:claim.target.employee_id,year:claim.job.year});
  return Response.json({completed});
 }catch(error){
  const message=error instanceof Error?error.message:'Sync failed';
  if(claim)await rpc('fail',{token:claim.token,employee_id:claim.target.employee_id,year:claim.job.year,error:message}).catch(()=>{});
  // Never log Google response bodies, row data or credentials.
  console.error('Sheets mirror failed:',message);
  return Response.json({error:'Sync queued for retry'},{status:503});
 }
});
