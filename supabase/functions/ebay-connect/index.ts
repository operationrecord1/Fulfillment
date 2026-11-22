import {authorizationUrl,newState,hashState,exchangeCode,sellerIdentity} from './oauth.mjs';
import scopes from './scopes.json' with {type:'json'};
const backend=Deno.env.get('SUPABASE_URL')!;
const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const key=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const origin='https://fulfilment.site';
const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
async function rpc(action:string,payload:unknown={}){
 const response=await fetch(backend+'/rest/v1/rpc/ebay_connection_worker',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({action,payload}),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Connection storage failed');return response.json();
}
function message(text:string,status=200){return new Response(text,{status,headers:{...headers,'Content-Type':'text/plain; charset=utf-8'}});}
Deno.serve(async(req:Request)=>{
 const url=new URL(req.url);
 if(req.method==='OPTIONS')return new Response(null,{headers});
 try{
  if(req.method==='POST'&&url.pathname.endsWith('/start')){
   if(req.headers.get('Origin')!==origin)return message('Origin not allowed.',403);
   const authorization=req.headers.get('Authorization');if(!authorization?.startsWith('Bearer '))return message('Sign in first.',401);
   const identity=await fetch(backend+'/auth/v1/user',{headers:{apikey:key,Authorization:authorization},signal:AbortSignal.timeout(15000)});
   if(!identity.ok)return message('Sign in first.',401);
   const user=await identity.json();
   const config=await rpc('credentials');
   if(!config.ebay_client_id||!config.ebay_client_secret||!config.ebay_runame)return message('eBay connection setup is not complete yet.',503);
   const body=await req.json(),state=newState();
   await rpc('begin',{user_id:user.id,store_id:body.store_id||null,hash:await hashState(state),scopes});
   return Response.json({url:authorizationUrl({clientId:config.ebay_client_id,ruName:config.ebay_runame,scopes,state})},{headers});
  }
  if(req.method==='GET'&&url.pathname.endsWith('/callback')){
   const state=url.searchParams.get('state');
   if(!state||!/^[a-f0-9]{64}$/.test(state))return message('Invalid connection request. Start from your signed-in workspace.',400);
   const saved=await rpc('consume',{hash:await hashState(state)});
   if(!saved)return message('This connection request expired or was already used. Start again from your workspace.',400);
   const code=url.searchParams.get('code');
   if(url.searchParams.has('error')||!code)return message('eBay connection was cancelled. Your existing workspace is unchanged.',400);
   const config=await rpc('credentials');
   const tokens=await exchangeCode({clientId:config.ebay_client_id,clientSecret:config.ebay_client_secret,ruName:config.ebay_runame,code});
   const seller=await sellerIdentity(tokens.access_token);
   const granted=typeof tokens.scope==='string'?tokens.scope.split(' '):saved.scopes;
   await rpc('save',{...saved,...seller,tokens,scopes:granted});
   return message('eBay store connected securely. Order and listing synchronization is not enabled yet. You can return to your Fulfilment workspace.');
  }
  return message('Not found.',404);
 }catch{
  // Do not log codes, credentials, provider response bodies, or tokens.
  return message('eBay connection could not be completed. Your existing order data is unchanged. Start again from your workspace.',400);
 }
});
