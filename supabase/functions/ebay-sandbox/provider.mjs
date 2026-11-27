import {inspectOrder,publishTracking,validateTracking,TrackingError} from '../ebay-tracking/provider.mjs';
export {validateTracking,TrackingError};
export const API='https://api.sandbox.ebay.com';
export function sandboxTransport(fetcher=fetch){return async(url,options={})=>{
 const u=new URL(url);
 if(u.origin==='https://api.ebay.com'&&u.pathname.startsWith('/sell/fulfillment/v1/order/'))u.hostname='api.sandbox.ebay.com';
 if(u.origin!==API)throw Error('Non-Sandbox API destination blocked');
 return fetcher(u.href,{...options,redirect:'error'});
};}
export class SandboxError extends Error {constructor(message,status=0,uncertain=false){super(message);this.status=status;this.uncertain=uncertain;}}
export async function jsonRequest(path,token,{method='GET',body}={},fetcher=fetch){
 if(!path.startsWith('/sell/fulfillment/v1/order'))throw Error('Unsupported Sandbox API path');
 let r;try{r=await sandboxTransport(fetcher)(API+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});}catch{throw new SandboxError('Sandbox API could not be reached',0,method!=='GET');}
 const data=await r.json().catch(()=>null);
 if(!r.ok||data?.errors?.length)throw new SandboxError('eBay Sandbox '+r.status+': '+(data?.errors?.map(x=>x.message).join('; ')||'Request failed'),r.status,method!=='GET'&&(r.status>=500||r.status===408||r.status===429));
 if(!data||typeof data!=='object')throw new SandboxError('Invalid Sandbox response');return data;
}
export const checkTracking=(id,token,fetcher=fetch)=>inspectOrder(id,token,sandboxTransport(fetcher));
export const sendTracking=(id,order,tracking,carrier,token,fetcher=fetch)=>publishTracking(id,order,tracking,carrier,token,sandboxTransport(fetcher));
export function xmlEscape(value){return String(value).replace(/[<>&"']/g,x=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[x]));}
export async function trading(call,body,token,parse,fetcher=fetch){
 if(!['GetUser','GetMyeBaySelling','GetItem','ReviseInventoryStatus','AddMemberMessageAAQToPartner','VerifyAddFixedPriceItem','AddFixedPriceItem'].includes(call))throw Error('Unsupported Sandbox Trading call');
 const writing=['ReviseInventoryStatus','AddMemberMessageAAQToPartner','AddFixedPriceItem'].includes(call);let r;
 try{r=await sandboxTransport(fetcher)(API+'/ws/api.dll',{method:'POST',headers:{'X-EBAY-API-CALL-NAME':call,'X-EBAY-API-SITEID':'0','X-EBAY-API-COMPATIBILITY-LEVEL':'1489','X-EBAY-API-IAF-TOKEN':token,'Content-Type':'text/xml'},body:'<?xml version="1.0" encoding="utf-8"?><'+call+'Request xmlns="urn:ebay:apis:eBLBaseComponents">'+body+'</'+call+'Request>',signal:AbortSignal.timeout(20000)});}catch{throw new SandboxError('Sandbox Trading API could not be reached',0,writing);}
 const raw=await r.text();if(raw.length>4000000||/<!DOCTYPE|<!ENTITY/i.test(raw))throw new SandboxError('Invalid XML response',r.status,writing);
 let d;try{d=parse(raw)[call+'Response'];}catch{throw new SandboxError('Invalid XML response',r.status,writing);}
 const errors=[].concat(d?.Errors||[]).filter(x=>x.SeverityCode==='Error');
 if(!r.ok||!d||!['Success','Warning'].includes(d.Ack)||errors.length)throw new SandboxError('eBay Sandbox '+r.status+': '+(errors.map(x=>x.ErrorCode+' '+x.LongMessage).join('; ')||'Trading response not confirmed'),r.status,writing&&(!d||r.status>=500));
 return d;
}
export async function orders(token,offset=0,fetcher=fetch){
 if(!Number.isInteger(offset)||offset<0||offset>100000)throw Error('Invalid orders offset');
 const d=await jsonRequest('/sell/fulfillment/v1/order?limit=50&offset='+offset,token,{},fetcher);
 if(!Number.isInteger(d.total)||d.total<0||!Array.isArray(d.orders)||d.orders.some(x=>!x.orderId))throw new SandboxError('Invalid orders response; count not confirmed');
 return {rows:d.orders,total:d.total,offset,limit:50,checked_at:new Date().toISOString(),period:'eBay default order window (last 90 days)'};
}
export async function listings(token,page,parse,fetcher=fetch){
 if(!Number.isInteger(page)||page<1||page>125)throw Error('Invalid listings page');
 const d=await trading('GetMyeBaySelling','<ActiveList><Include>true</Include><Pagination><EntriesPerPage>50</EntriesPerPage><PageNumber>'+page+'</PageNumber></Pagination></ActiveList>',token,parse,fetcher);
 const list=d.ActiveList;if(list===undefined&&d.Ack==='Success'&&d.Timestamp)return {rows:[],total:null,page,limit:50,checked_at:new Date().toISOString(),period:'Active listings',notice:'eBay returned no ActiveList container. No records returned; total count unavailable.'};const total=Number(list?.PaginationResult?.TotalNumberOfEntries);
 if(!list||!Number.isInteger(total)||total<0)throw new SandboxError('Listing total not confirmed by Sandbox API');
 const rows=[].concat(list.ItemArray?.Item||[]);if(rows.some(x=>!x.ItemID))throw new SandboxError('Invalid listing identity');
 return {rows,total,page,limit:50,checked_at:new Date().toISOString(),period:'Active listings'};
}
export async function ownItem(id,token,username,parse,fetcher=fetch){
 if(!/^\d{1,30}$/.test(id))throw Error('Invalid item ID');
 const d=await trading('GetItem','<ItemID>'+id+'</ItemID><DetailLevel>ReturnAll</DetailLevel>',token,parse,fetcher);
 if(String(d.Item?.ItemID)!==id||String(d.Item?.Seller?.UserID).toLowerCase()!==username.toLowerCase())throw Error('Listing seller does not match connected Sandbox account');return d.Item;
}
export function listingChange(price,quantity){
 if(typeof price!=='string'||!/^\d{1,7}(\.\d{1,2})?$/.test(price)||Number(price)<=0||!Number.isInteger(quantity)||quantity<0||quantity>100000)throw Error('Enter a positive price and a whole quantity from 0 to 100000');
 return {price:Number(price).toFixed(2),quantity};
}
