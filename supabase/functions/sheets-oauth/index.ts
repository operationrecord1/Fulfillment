import {backendUrl,isAdmin,rpc} from '../sheets-sync/backend.ts';
const redirectUri=backendUrl+'/functions/v1/sheets-oauth/callback';
const owner='operation.record1@gmail.com';
const cors={'Access-Control-Allow-Origin':'https://fulfilment.site','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'};
const bytes=(value:Uint8Array)=>btoa(String.fromCharCode(...value)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const digest=async(value:string)=>bytes(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
Deno.serve(async(req:Request)=>{
 const url=new URL(req.url);
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 try{
  if(req.method==='POST'&&url.pathname.endsWith('/start')){
   if(!await isAdmin(req.headers.get('Authorization')))return Response.json({error:'Administrator required'},{status:403,headers:cors});
   const config=await rpc('credentials');
   if(!config.sheets_google_client_id||!config.sheets_google_client_secret)throw Error('Google client not configured');
   const state=bytes(crypto.getRandomValues(new Uint8Array(32))),verifier=bytes(crypto.getRandomValues(new Uint8Array(48)));
   await rpc('oauth_begin',{hash:await digest(state),verifier});
   const params=new URLSearchParams({client_id:config.sheets_google_client_id,redirect_uri:redirectUri,response_type:'code',scope:'openid email https://www.googleapis.com/auth/drive.file',access_type:'offline',prompt:'consent',login_hint:owner,state,code_challenge:await digest(verifier),code_challenge_method:'S256'});
   return Response.json({url:'https://accounts.google.com/o/oauth2/v2/auth?'+params},{headers:cors});
  }
  if(req.method==='GET'&&url.pathname.endsWith('/callback')){
   const state=url.searchParams.get('state'),code=url.searchParams.get('code');
   if(!state||!code||url.searchParams.has('error'))return new Response('Google connection was not completed.',{status:400,headers:cors});
   const saved=await rpc('oauth_consume',{hash:await digest(state)});
   if(!saved?.verifier)return new Response('This connection link expired. Start again from the administrator session.',{status:400,headers:cors});
   const config=await rpc('credentials');
   const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:config.sheets_google_client_id,client_secret:config.sheets_google_client_secret,code,redirect_uri:redirectUri,grant_type:'authorization_code',code_verifier:saved.verifier}),signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw Error('Google token exchange failed');
   const tokens=await response.json();
   const identity=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+tokens.access_token},signal:AbortSignal.timeout(15000)});
   if(!identity.ok)throw Error('Google owner verification failed');
   const user=await identity.json();
   if(user.email!==owner||user.email_verified!==true)throw Error('Please connect the designated owner account');
   if(!String(tokens.scope||'').split(' ').includes('https://www.googleapis.com/auth/drive.file'))throw Error('Required file access was not granted');
   await rpc('oauth_save',{email:user.email,refresh_token:tokens.refresh_token});
   return new Response('Google Sheets connected to '+owner+'. Your existing order data is unchanged. The first sync will be verified before automatic syncing is enabled.',{headers:{...cors,'Content-Type':'text/plain; charset=utf-8','Referrer-Policy':'no-referrer'}});
  }
  return new Response('Not found',{status:404,headers:cors});
 }catch{
  return new Response('Google connection could not be completed. Please restart the connection from the administrator session.',{status:400,headers:cors});
 }
});
