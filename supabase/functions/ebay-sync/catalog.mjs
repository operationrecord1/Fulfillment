import {ProviderError} from './provider.mjs';
const array=x=>x==null?[]:Array.isArray(x)?x:[x];
const val=x=>typeof x==='object'?x?.['#text']:x;
export function listingRecord(item,now=new Date().toISOString()){
 const id=String(item.ItemID||'');if(!/^\d+$/.test(id))throw new ProviderError('Invalid listing item ID');
 const price=val(item.SellingStatus?.CurrentPrice??item.StartPrice),quantity=Number(item.QuantityAvailable??Math.max(0,Number(item.Quantity||0)-Number(item.SellingStatus?.QuantitySold||0)));
 const images=array(item.PictureDetails?.PictureURL||item.PictureDetails?.GalleryURL).filter(x=>typeof x==='string'&&x.startsWith('https://'));
 const state=item.SellingStatus?.ListingStatus==='Completed'||item.SellingStatus?.ListingStatus==='Ended'?'ENDED':'ACTIVE';
 return {id,data:{listingId:id,catalog_present:state==='ACTIVE',syncCategory:state.toLowerCase(),source:'ebay_trading',observedAt:now,listing:{marketplace:'EBAY_US',sellerProduct:{title:item.Title||'',images:images.map((url,i)=>({order:i+1,ebayImageUrl:url}))},listingTerms:{totalQuantityAvailable:quantity,listingFormat:item.ListingType,lifecycleTerms:{listingStatus:state,startAt:item.ListingDetails?.StartTime,actualEndAt:item.ListingDetails?.EndTime}},items:[{itemId:id,sku:item.SKU||null,itemTerms:{availability:{quantityAvailable:quantity,quantitySold:Number(item.SellingStatus?.QuantitySold||0)},pricingTerms:{fixedPrice:{original:{value:price==null?null:Number(price),currency:'USD'}}}}}]}}};
}
export async function readCatalog(job,token,fetcher,parseXML,now=Date.now()){
 const c=job.cursor||{},page=c.page||1,end=c.end||new Date(now).toISOString();
 const response=await fetcher('https://api.ebay.com/ws/api.dll',{method:'POST',headers:{'Content-Type':'text/xml','X-EBAY-API-IAF-TOKEN':token,'X-EBAY-API-CALL-NAME':'GetMyeBaySelling','X-EBAY-API-SITEID':'0','X-EBAY-API-COMPATIBILITY-LEVEL':'1489'},body:'<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>'+page+'</PageNumber></Pagination></ActiveList><HideVariations>false</HideVariations><DetailLevel>ReturnAll</DetailLevel></GetMyeBaySellingRequest>',signal:AbortSignal.timeout(20000)});
 const d=parseXML(await response.text())?.GetMyeBaySellingResponse;
 if(!response.ok||!['Success','Warning'].includes(d?.Ack))throw new ProviderError('eBay catalog request failed: '+array(d?.Errors).filter(e=>e.SeverityCode==='Error').map(e=>e.ErrorCode).join(','),response.status,300);
 const active=d.ActiveList,total=Number(active?.PaginationResult?.TotalNumberOfEntries),pages=Number(active?.PaginationResult?.TotalNumberOfPages),items=array(active?.ItemArray?.Item);
 if(!Number.isInteger(total)||total<0||!Number.isInteger(pages)||pages>10000||page>Math.max(1,pages)||items.length===0&&total>0)throw new ProviderError('Incomplete catalog page '+page+'/'+pages+' total '+total+' items '+items.length);
 if(c.total!==undefined&&c.total!==total)throw new ProviderError('Catalog count changed during scan ('+c.total+' to '+total+'); restarting safely');
 const records=items.map(x=>listingRecord(x,end)),done=page>=pages;
 return {records,done,cursor:done?{}:{source:'trading',page:page+1,total,end},watermark:end,snapshot:{id:end,totals:{active:total}},...(done?{reconcile_active_before:end}:{})};
}
export async function readMissingImages(job,token,fetcher,parseXML){
 const records=[];
 for(const id of job.image_ids||[]){
  if(!/^\d+$/.test(id))continue;
  const r=await fetcher('https://api.ebay.com/ws/api.dll',{method:'POST',headers:{'Content-Type':'text/xml','X-EBAY-API-IAF-TOKEN':token,'X-EBAY-API-CALL-NAME':'GetItem','X-EBAY-API-SITEID':'0','X-EBAY-API-COMPATIBILITY-LEVEL':'1489'},body:'<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>'+id+'</ItemID><DetailLevel>ReturnAll</DetailLevel></GetItemRequest>',signal:AbortSignal.timeout(15000)});
  const d=parseXML(await r.text())?.GetItemResponse;if(r.ok&&['Success','Warning'].includes(d?.Ack)&&String(d.Item?.ItemID)===id)records.push(listingRecord(d.Item));
 }
 return records;
}
