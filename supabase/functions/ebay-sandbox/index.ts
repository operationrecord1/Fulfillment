import {categoryOptions,fixture,fixtureLookup} from './fixtures.mjs';
import {XMLParser,XMLValidator} from 'npm:fast-xml-parser@5.12.1';
import {orders,listings,jsonRequest,trading,ownItem,listingChange,checkTracking,sendTracking,validateTracking,SandboxError,TrackingError,xmlEscape} from './provider.mjs';
import {newState,hashState} from '../ebay-connect/oauth.mjs';
const backend=Deno.env.get('SUPABASE_URL')!;
const key=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const origin='https://fulfilment.site';
const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
const scopes=['','/sell.inventory','/sell.fulfillment','/commerce.identity.readonly','/commerce.message','/sell.listing','/sell.order.read','/sell.cancellation.read','/sell.return.read','/sell.refund.read','/commerce.usernote'].map(s=>'https://api.ebay.com/oauth/api_scope'+s);
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,processEntities:false});
const parse=(text:string)=>{if(XMLValidator.validate(text)!==true)throw Error('Invalid XML');return parser.parse(text);};
async function rpc(actor:string,action:string,payload:any={}){const r=await fetch(backend+'/rest/v1/rpc/ebay_sandbox_worker',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({action,payload:{...payload,actor}}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Sandbox storage or permission check failed');return r.json();}
async function seller(token:string){const d=await trading('GetUser','',token,parse);const name=d.User?.UserID;if(typeof name!=='string'||!name.toUpperCase().startsWith('TESTUSER_'))throw Error('Verified Sandbox test seller required');return name;}
async function oauth(config:any,values:any){
 if(!config.client_id?.includes('-SBX-')||!config.client_secret||!config.runame)throw Error('Sandbox OAuth keys are not configured');
 const r=await fetch('https://api.sandbox.ebay.com/identity/v1/oauth2/token',{method:'POST',redirect:'error',headers:{Authorization:'Basic '+btoa(config.client_id+':'+config.client_secret),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values),signal:AbortSignal.timeout(20000)});
 const d=await r.json().catch(()=>null);if(!r.ok||!d?.access_token||!Number.isFinite(d.expires_in))throw Error('Sandbox authorization expired, declined, or unavailable. Reconnect.');return {...d,expires_at:Date.now()+d.expires_in*1000};
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 let actor='',action='',attempt='',kind='',target='',sent=false,accepted=false;
 const response=(data:any,status=200)=>Response.json({...data,environment:'sandbox'},{status,headers});
 try{
  const url=new URL(req.url);
  if(req.method==='GET'&&url.pathname.endsWith('/callback')){
   const state=url.searchParams.get('state');if(!state||!/^[a-f0-9]{64}$/.test(state))throw Error('Invalid Sandbox authorization state');
   const saved=await rpc('','consume',{hash:await hashState(state)});actor=saved.actor;
   if(url.searchParams.has('error')||!url.searchParams.get('code'))throw Error('Sandbox authorization cancelled');
   const config=await rpc(actor,'credentials');const tokens=await oauth(config,{grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:config.runame});
   const username=await seller(tokens.access_token);await rpc(actor,'connect',{username,tokens});
   await rpc(actor,'event',{name:'oauth',outcome:'confirmed',detail:'Refreshable Sandbox connection verified for '+username});
   return new Response(null,{status:303,headers:{...headers,Location:origin+'/#workspace/sandbox/connection'}});
  }
  if(req.method!=='POST')return response({error:'Method not allowed'},405);
  if(req.headers.get('origin')&&req.headers.get('origin')!==origin)return response({error:'Origin not allowed'},403);
  const userResponse=await fetch(backend+'/auth/v1/user',{headers:{apikey:key,Authorization:req.headers.get('authorization')||''},signal:AbortSignal.timeout(10000)});
  if(!userResponse.ok)return response({error:'Sign in required'},401);actor=(await userResponse.json()).id;
  const raw=await req.text();if(raw.length>30000)throw Error('Request too large');const body=JSON.parse(raw);action=body.action;
  const status=await rpc(actor,'status');
  if(action==='status'){let mode='disconnected';if(status.connected){const c=await rpc(actor,'token');mode=c.tokens.refresh_token?'refreshable':'temporary';}return response({...status,mode,callback_url:backend+'/functions/v1/ebay-sandbox/callback'});}
  if(action==='events')return response({events:await rpc(actor,'events')});
  if(action==='configure'){
   const c=body.config;if(typeof c?.client_id!=='string'||!c.client_id.includes('-SBX-')||typeof c.client_secret!=='string'||!c.client_secret.trim()||typeof c.runame!=='string'||!c.runame.trim())throw Error('Enter Sandbox Client ID, Client Secret and RuName');
   if(status.configured)throw Error('OAuth settings already configured; use the saved keyset.');
   await rpc(actor,'configure',{config:{client_id:c.client_id.trim(),client_secret:c.client_secret.trim(),runame:c.runame.trim()}});return response({configured:true});
  }
  if(action==='connect_start'){
   const c=await rpc(actor,'credentials');if(!c.client_id||!c.runame)throw Error('Configure the Sandbox keyset first');
   const state=newState();await rpc(actor,'begin',{hash:await hashState(state)});
   const u=new URL('https://auth.sandbox.ebay.com/oauth2/authorize');u.search=new URLSearchParams({client_id:c.client_id,redirect_uri:c.runame,response_type:'code',scope:scopes.join(' '),state}).toString();return response({url:u.href});
  }
  if(action==='connect'){
   if(typeof body.token!=='string'||body.token.length<30||body.token.length>20000)throw Error('Enter the generated Sandbox user token');
   const username=await seller(body.token.trim());await rpc(actor,'connect',{username,tokens:{access_token:body.token.trim()}});await rpc(actor,'event',{name:action,outcome:'confirmed',detail:'Temporary Sandbox token verified for '+username});return response({connected:true,username,mode:'temporary'});
  }
  const ctx=await rpc(actor,'token');let token=ctx.tokens.access_token;
  const refresh=async()=>{if(!ctx.tokens.refresh_token)throw Error('Temporary Sandbox token expired. Reconnect with a new token or configure OAuth.');const c=await rpc(actor,'credentials');const fresh=await oauth(c,{grant_type:'refresh_token',refresh_token:ctx.tokens.refresh_token,scope:scopes.join(' ')});ctx.tokens={...ctx.tokens,...fresh};token=fresh.access_token;await rpc(actor,'connect',{username:ctx.username,tokens:ctx.tokens});};
  if(ctx.tokens.expires_at&&ctx.tokens.expires_at<Date.now()+60000)await refresh();
  const read=async(fn:any)=>{try{return await fn();}catch(e){if(e.status===401){await refresh();return fn();}throw e;}};
  let result:any;
  if(action==='refresh_verify'){await refresh();const verified=await seller(token);if(verified.toLowerCase()!==ctx.username.toLowerCase())throw Error('Refreshed token identity mismatch');result={verified:true,username:verified,message:'Token refresh and Sandbox seller identity verified'};}
  else if(action==='fixture_categories'){const config=await rpc(actor,'credentials');const app=await oauth(config,{grant_type:'client_credentials',scope:'https://api.ebay.com/oauth/api_scope'});result={categories:await categoryOptions(app.access_token)};}
  else if(['fixture_verify','fixture_create'].includes(action)){
   const uuid=(await hashState(actor+':creston-fixture-v1:'+body.slot)).slice(0,32).toUpperCase();const shipping=await read(()=>trading('GeteBayDetails','<DetailName>ShippingServiceDetails</DetailName>',token,parse));const services=[].concat(shipping.ShippingServiceDetails||[]);const selected=services.find((s:any)=>s.ShippingService==='USPSPriority'&&s.ValidForSellingFlow==='true');if(!selected)throw Error('Sandbox did not confirm USPSPriority as a supported shipping service');const f=fixture(body.slot,body.category,uuid,selected.ShippingService);kind='fixture';target=f.sku;
   let existing:any=null;
   try{existing=(await read(()=>trading('GetItem',fixtureLookup(f.sku),token,parse))).Item;}catch(e){if(!String(e.message).includes('21916270'))throw e;}
   if(existing){if(String(existing.Seller?.UserID).toLowerCase()!==ctx.username.toLowerCase()||existing.SKU!==f.sku)throw Error('Fixture ownership mismatch');const old=await rpc(actor,'action',{kind,target});if(old.state==='unknown')await rpc(actor,'finish',{kind,target,attempt:old.attempt,state:'confirmed'});result={existing:true,item:existing,message:'Existing Sandbox fixture found; no duplicate created'};}
   else{
    const checked=await read(()=>trading('VerifyAddFixedPriceItem',f.xml,token,parse));
    if(action==='fixture_verify')result={verified:true,title:f.title,sku:f.sku,warnings:checked.Errors||[],message:'eBay validated this test listing. It has not been published.'};
    else{const claim=await rpc(actor,'claim',{kind,target,requested:{category:body.category,slot:body.slot,sku:f.sku}});if(!claim.claimed)throw Error('Previous fixture creation needs reconciliation; duplicate blocked');attempt=claim.attempt;sent=true;
     const created=await trading('AddFixedPriceItem',f.xml,token,parse);accepted=true;
     if(!/^\d+$/.test(String(created.ItemID)))throw new SandboxError('Listing accepted but ID unavailable',0,true);
     const item=await ownItem(String(created.ItemID),token,ctx.username,parse);if(item.SKU!==f.sku)throw new SandboxError('Fixture read-back mismatch',0,true);
     await rpc(actor,'finish',{kind,target,attempt,state:'confirmed'});result={item,confirmed:true,message:'Test listing created and verified on eBay Sandbox'};
    }
   }
  }
  else if(action==='orders')result=await read(()=>orders(token,body.offset??0));
  else if(action==='listings')result=await read(()=>listings(token,body.page??1,parse));
  else if(['tracking_check','tracking_submit'].includes(action)){
   target=body.order_id;if(typeof target!=='string'||!target||target.length>100)throw Error('Invalid order ID');kind='tracking';
   let live=await read(()=>checkTracking(target,token));const previous=await rpc(actor,'action',{kind,target});
   if(previous.state==='unknown'&&live.shipments.some((x:any)=>x.tracking===previous.requested?.tracking&&x.carrier.toLowerCase()===previous.requested?.carrier?.toLowerCase()))await rpc(actor,'finish',{kind,target,attempt:previous.attempt,state:'confirmed'});
   if(action==='tracking_check')result={...live,order:undefined,blocked:live.blocked||['unknown','confirmed'].includes(previous.state),reason:live.reason||(['unknown','confirmed'].includes(previous.state)?'Previous submission is recorded; additional tracking is blocked.':'')};
   else{
    if(live.blocked)throw Error(live.reason);const values=validateTracking(body.tracking,body.carrier);const claim=await rpc(actor,'claim',{kind,target,requested:values});if(!claim.claimed)throw Error('Existing or uncertain tracking submission blocks another send');attempt=claim.attempt;
    // Claim persists unknown BEFORE the only external POST. A crash cannot cause a blind retry.
    live=await checkTracking(target,token);if(live.blocked){await rpc(actor,'finish',{kind,target,attempt,state:'rejected'});throw Error(live.reason);}
    sent=true;await sendTracking(target,live.order,values.tracking,values.carrier,token);accepted=true;
    const verified=await checkTracking(target,token);if(!verified.shipments.some((x:any)=>x.tracking===values.tracking&&x.carrier.toLowerCase()===values.carrier.toLowerCase()))throw new SandboxError('Accepted by eBay; read-back confirmation pending',0,true);
    await rpc(actor,'finish',{kind,target,attempt,state:'confirmed'});result={...verified,order:undefined,blocked:true,reason:'Tracking confirmed on eBay Sandbox'};
   }
  }else if(['listing_read','listing_update'].includes(action)){
   target=String(body.item_id||'');kind='listing';const item=await read(()=>ownItem(target,token,ctx.username,parse));
   if(action==='listing_read'){
    const previous=await rpc(actor,'action',{kind,target});let confirmed=false;
    if(previous.state==='unknown'&&Number(item.SellingStatus?.CurrentPrice?.['#text'])===Number(previous.requested?.price)&&Number(item.Quantity)-Number(item.SellingStatus?.QuantitySold||0)===previous.requested?.quantity){await rpc(actor,'finish',{kind,target,attempt:previous.attempt,state:'confirmed'});confirmed=true;}
    result={item,confirmed,checked_at:new Date().toISOString()};
   }
   else{
    if(item.ListingType!=='FixedPriceItem'||item.SellingStatus?.ListingStatus!=='Active'||item.Variations)throw Error('Only active single-variation fixed-price listings are supported for this test');
    const values=listingChange(body.price,body.quantity);const currency=item.SellingStatus?.CurrentPrice?.['@_currencyID'];if(!currency)throw Error('Listing currency is unavailable');
    const claim=await rpc(actor,'claim',{kind,target,requested:values});if(!claim.claimed)throw Error('An uncertain listing update needs verification before another update');attempt=claim.attempt;sent=true;
    await trading('ReviseInventoryStatus','<InventoryStatus><ItemID>'+target+'</ItemID><StartPrice currencyID="'+xmlEscape(currency)+'">'+values.price+'</StartPrice><Quantity>'+values.quantity+'</Quantity></InventoryStatus>',token,parse);accepted=true;
    const verified=await ownItem(target,token,ctx.username,parse);const available=Number(verified.Quantity)-Number(verified.SellingStatus?.QuantitySold||0);
    if(Number(verified.SellingStatus?.CurrentPrice?.['#text'])!==Number(values.price)||available!==values.quantity)throw new SandboxError('Listing update accepted; read-back differs or is pending',0,true);
    await rpc(actor,'finish',{kind,target,attempt,state:'confirmed'});result={item:verified,confirmed:true,checked_at:new Date().toISOString()};
   }
  }else if(action==='message_send'){
   const id=body.order_id;if(typeof id!=='string'||!id||id.length>100)throw Error('Invalid order ID');
   if(typeof body.message!=='string'||!body.message.trim()||body.message.length>2000||/[<>]/.test(body.message))throw Error('Enter a plain-text message of up to 2000 characters');
   const order=await read(()=>jsonRequest('/sell/fulfillment/v1/order/'+encodeURIComponent(id),token));
   const recipient=order.buyer?.username,item=order.lineItems?.[0]?.legacyItemId;
   if(order.orderId!==id||typeof recipient!=='string'||!recipient.toUpperCase().startsWith('TESTUSER_')||!item)throw Error('Verified Sandbox buyer and listing required');
   kind='message';target=id+':'+await hashState(body.message.trim());const claim=await rpc(actor,'claim',{kind,target,requested:{order_id:id}});
   if(!claim.claimed)throw Error('This message was already submitted or its outcome is unknown. Duplicate blocked.');attempt=claim.attempt;sent=true;
   await trading('AddMemberMessageAAQToPartner','<ItemID>'+xmlEscape(item)+'</ItemID><MemberMessage><Subject>About your test order '+xmlEscape(id)+'</Subject><Body>'+xmlEscape(body.message.trim())+'</Body><QuestionType>General</QuestionType><RecipientID>'+xmlEscape(recipient)+'</RecipientID><EmailCopyToSender>false</EmailCopyToSender></MemberMessage>',token,parse);accepted=true;
   await rpc(actor,'finish',{kind,target,attempt,state:'confirmed'});result={accepted:true,recipient,message:'eBay Sandbox accepted the message. Receipt must be checked in the test buyer inbox.'};
  }else throw Error('Unsupported Sandbox action');
  await rpc(actor,'event',{name:action,outcome:'confirmed',detail:target||result.message||(Array.isArray(result.rows)?('API response verified; '+result.rows.length+' records on this page'+(result.total===null?'; total unavailable':'')):'API response verified')});
  return response(result);
 }catch(e){
  const uncertain=sent&&(accepted||!(e instanceof SandboxError||e instanceof TrackingError)||e.uncertain||!e.status);
  if(attempt&&!uncertain)try{await rpc(actor,'finish',{kind,target,attempt,state:'rejected'});}catch{}
  // Never log request bodies, authorization codes, tokens or credentials.
  const detail=String(e.message||'Sandbox operation failed').slice(0,600);
  if(actor&&action)try{await rpc(actor,'event',{name:action,outcome:uncertain?'unknown':'error',detail});}catch{}
  return response({error:detail,state:uncertain?'unknown':'error',blocked:true},400);
 }
});
