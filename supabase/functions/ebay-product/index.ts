import {trading,xml} from '../ebay-notes/provider.mjs';
import {refreshAccess} from '../ebay-sync/provider.mjs';
const base=Deno.env.get('SUPABASE_URL')!;
const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const key=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const headers={'Access-Control-Allow-Origin':'https://fulfilment.site','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Cache-Control':'no-store'};
async function rpc(name:string,body:unknown={}){const r=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Product Access Unavailable');return r.json();}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return new Response('Method Not Allowed',{status:405,headers});
 try{
  const auth=req.headers.get('authorization')||'';
  const userResponse=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:auth}});
  if(!userResponse.ok)return Response.json({error:'Sign In Required'},{status:401,headers});
  const user=await userResponse.json(),body=await req.json();
  const payload={actor:user.id,store_id:body.store_id,order_id:body.order_id};
  const context=await rpc('ebay_product_worker',{action:'context',payload});let token=context.tokens.access_token;
  if(Date.parse(context.access_expires_at)<=Date.now()+60000){const config=await rpc('ebay_connection_worker',{action:'credentials'});const fresh=await refreshAccess(config,context.tokens.refresh_token);await rpc('ebay_product_worker',{action:'token',payload:{...payload,tokens:fresh}});token=fresh.access_token;}
  const items=[];
  for(const line of context.items){
   const d=await trading('GetItem','<ItemID>'+xml(line.legacyItemId)+'</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>true</IncludeItemSpecifics>',token);
   const item=d.Item;items.push({id:line.legacyItemId,title:item.Title||line.title,description:item.Description||'',order_quantity:line.quantity,quantity:item.Quantity,quantity_sold:item.SellingStatus?.QuantitySold,image:Array.isArray(item.PictureDetails?.PictureURL)?item.PictureDetails.PictureURL[0]:item.PictureDetails?.PictureURL});
  }
  return Response.json({items},{headers});
 }catch{return Response.json({error:'Product Details Could Not Load from eBay. Please Try Again.'},{status:502,headers});}
});
