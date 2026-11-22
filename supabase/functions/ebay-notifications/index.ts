import {challenge,signatureMetadata,verifyPayload} from './verify.mjs';
const base=Deno.env.get('SUPABASE_URL')!;
const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const key=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const endpoint=base+'/functions/v1/ebay-notifications';
const api='https://api.ebay.com/commerce/notification/v1';
async function rpc(name:string,body:unknown){const r=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Notification storage unavailable');return r.json();}
const work=(action:string,payload:unknown={})=>rpc('ebay_notification_worker',{action,payload});
let appToken='',appExpiry=0;const publicKeys=new Map();
async function applicationToken(){
 if(appToken&&Date.now()<appExpiry)return appToken;
 const c=await rpc('ebay_connection_worker',{action:'credentials',payload:{}});
 const r=await fetch('https://api.ebay.com/identity/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+btoa(c.ebay_client_id+':'+c.ebay_client_secret),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',scope:'https://api.ebay.com/oauth/api_scope'}),signal:AbortSignal.timeout(15000)});
 const d=await r.json();if(!r.ok||!d.access_token)throw Error('eBay application authentication failed');appToken=d.access_token;appExpiry=Date.now()+(d.expires_in-120)*1000;return appToken;
}
async function call(path:string,token:string,method='GET',body?:unknown){
 const r=await fetch(api+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Error('eBay '+r.status+' '+JSON.stringify(d.errors?.map((x:any)=>({id:x.errorId,message:x.message}))||[]));
 return {...d,location:r.headers.get('location')};
}
async function setup(inspect=false){
 const token=await applicationToken(),cfg=await work('config'),topics=[];
 for(let offset=0;offset<500;offset+=100){const d=await call('/topic?limit=100&offset='+offset,token);topics.push(...(d.topics||[]));if(!d.next)break;}
 const wanted=topics.filter((t:any)=>['LISTING','ORDER_CONFIRMATION','ITEM_MARKED_SHIPPED','ORDER_CANCELLATION_ACTIVITY'].includes(t.topicId));
 if(inspect)return {topics:topics.map((t:any)=>({id:t.topicId,status:t.status,scope:t.scope,payloads:t.supportedPayloads})),destinations:await call('/destination',token)};
 let destinationId=cfg.destinationId;
 if(!destinationId){
  const destinations=await call('/destination',token);destinationId=destinations.destinations?.find((d:any)=>d.deliveryConfig?.endpoint===endpoint)?.destinationId;
  if(!destinationId){const conf=await call('/config',token);if(!conf.alertEmail)await call('/config',token,'PUT',{alertEmail:'operation.record1@gmail.com'});
   const created=await call('/destination',token,'POST',{name:'Fulfilment central events',status:'ENABLED',deliveryConfig:{endpoint,verificationToken:cfg.verificationToken}});destinationId=created.location?.split('/').pop();}
  if(!destinationId)throw Error('Destination identifier missing');await work('destination',{id:destinationId});
 }
 const results=[];
 for(const store of await work('stores')){
  const userToken=store.tokens.access_token;
  if(Date.parse(store.access_expires_at)<Date.now()+30000){results.push({store:store.store_id,error:'Access token refresh pending'});continue;}
  const existing=await call('/subscription?limit=100',userToken);
  for(const topic of wanted){try{
   let sub=existing.subscriptions?.find((s:any)=>s.topicId===topic.topicId&&s.destinationId===destinationId);
   if(!sub){const p=topic.supportedPayloads?.find((p:any)=>!p.deprecated&&p.format?.includes('JSON'));if(!p)throw Error('No supported JSON payload');const created=await call('/subscription',userToken,'POST',{topicId:topic.topicId,destinationId,status:'ENABLED',payload:{deliveryProtocol:'HTTPS',format:'JSON',schemaVersion:p.schemaVersion}});sub={subscriptionId:created.location?.split('/').pop(),status:'ENABLED'};}
   if(sub.status!=='ENABLED')await call('/subscription/'+encodeURIComponent(sub.subscriptionId)+'/enable',userToken,'POST');
   await work('subscription',{store_id:store.store_id,topic:topic.topicId,id:sub.subscriptionId,status:'ENABLED'});
   results.push({store:store.store_id,topic:topic.topicId,id:sub.subscriptionId,status:'ENABLED'});
  }catch(e){results.push({store:store.store_id,topic:topic.topicId,error:e.message});}}
 }
 const result={destinationId,results,missing:['LISTING','ORDER_CONFIRMATION','ITEM_MARKED_SHIPPED','ORDER_CANCELLATION_ACTIVITY'].filter(t=>!wanted.some((w:any)=>w.topicId===t))};await work('result',result);return result;
}
Deno.serve(async(req:Request)=>{
 const url=new URL(req.url);
 let stage='request';
 try{
  if(req.method==='GET'&&url.searchParams.has('challenge_code')){const code=url.searchParams.get('challenge_code')!;if(code.length>1024)return new Response('Invalid challenge',{status:400});const cfg=await work('config');return Response.json({challengeResponse:challenge(code,cfg.verificationToken,endpoint)});}
  if(req.method!=='POST')return new Response('Method not allowed',{status:405});
  if(['/setup','/inspect','/test','/verify-traffic','/limits'].some(p=>url.pathname.endsWith(p))){
   const candidate=req.headers.get('x-fulfillment-webhook-secret');if(!candidate||!await rpc('verify_fulfillment_webhook',{candidate}))return new Response('Unauthorized',{status:401});
   try{
    if(url.pathname.endsWith('/limits')){const results=[];const ar=await fetch('https://api.ebay.com/developer/analytics/v1_beta/rate_limit/?api_name=analytics&api_context=sell',{headers:{Authorization:'Bearer '+await applicationToken()},signal:AbortSignal.timeout(15000)});results.push({scope:'application',status:ar.status,data:await ar.json().catch(()=>({}))});for(const store of await work('stores')){const r=await fetch('https://api.ebay.com/developer/analytics/v1_beta/user_rate_limit/?api_name=analytics&api_context=sell',{headers:{Authorization:'Bearer '+store.tokens.access_token},signal:AbortSignal.timeout(15000)});results.push({store:store.store_id,status:r.status,data:await r.json().catch(()=>({}))});}return Response.json({results});}
    if(url.pathname.endsWith('/test')){
     const cfg=await work('config'),results=[];
     for(const store of await work('stores')){const list=await call('/subscription?limit=100',store.tokens.access_token);for(const s of list.subscriptions||[]){if(s.destinationId!==cfg.destinationId)continue;try{await call('/subscription/'+encodeURIComponent(s.subscriptionId)+'/test',store.tokens.access_token,'POST');results.push({topic:s.topicId,test:'sent'});}catch(e){results.push({topic:s.topicId,error:e.message});}}}
     return Response.json({results});
    }
    if(url.pathname.endsWith('/verify-traffic')){
     const input=await req.json(),store=(await work('stores')).find((s:any)=>s.store_id===input.store_id);if(!store)throw Error('Store not found');
     const rows=await work('traffic_sample',{store_id:store.store_id}),results=[];
     for(const row of rows){const d=row.data,p=new URLSearchParams({dimension:'LISTING',filter:`listing_ids:{${row.id}},date_range:[${d.requestedFrom}..${d.requestedTo}]`,metric:'TOTAL_IMPRESSION_TOTAL,LISTING_VIEWS_TOTAL,TRANSACTION'});
      const r=await fetch('https://api.ebay.com/sell/analytics/v1/traffic_report?'+p,{headers:{Authorization:'Bearer '+store.tokens.access_token},signal:AbortSignal.timeout(15000)}),fresh=await r.json();if(!r.ok)throw Error('Traffic verification failed '+r.status);
      results.push({listing:row.id,from:d.requestedFrom,to:d.requestedTo,saved:d.metricValues,fresh:fresh.records?.[0]?.metricValues,metrics:fresh.header?.metrics?.map((m:any)=>m.key),sourceUpdated:fresh.lastUpdatedDate});
     }
     return Response.json({results});
    }
    return Response.json(await setup(url.pathname.endsWith('/inspect')));
   }catch(e){if(url.pathname.endsWith('/setup'))await work('result',{error:e.message});return Response.json({error:e.message},{status:502});}
  }
  stage='signature';const header=req.headers.get('x-ebay-signature');if(!header)return new Response('Signature required',{status:401});
  if(Number(req.headers.get('content-length'))>262144)return new Response('Too large',{status:413});
  const raw=await req.text();if(raw.length>262144)return new Response('Too large',{status:413});
  let s;try{s=signatureMetadata(header);}catch{return new Response('Invalid signature',{status:412});}
  stage='public-key';let pub=publicKeys.get(s.kid);if(!pub||pub.expires<Date.now()){pub={value:await call('/public_key/'+encodeURIComponent(s.kid),await applicationToken()),expires:Date.now()+3600000};if(publicKeys.size>100)publicKeys.clear();publicKeys.set(s.kid,pub);}
  stage='verify';
  if(!verifyPayload(raw,s,pub.value))return new Response('Invalid signature',{status:412});
  const data=JSON.parse(raw);if(!data.notification?.notificationId||!data.notification?.eventDate)return new Response('Invalid notification',{status:400});
  stage='enqueue';await work('enqueue',data);return new Response(null,{status:204});
 }catch{console.error('Notification failed at '+stage);return new Response('Notification temporarily unavailable',{status:503});}
});
