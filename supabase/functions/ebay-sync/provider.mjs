export class ProviderError extends Error {
 constructor(code,status=0,retryAfter=0){super(code);this.status=status;this.retryAfter=retryAfter;}
}
export async function refreshAccess(config,refreshToken,fetcher=fetch){
 const response=await fetcher('https://api.ebay.com/identity/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+btoa(config.ebay_client_id+':'+config.ebay_client_secret),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refreshToken}),signal:AbortSignal.timeout(15000)});
 const data=await response.json();
 if(!response.ok)throw new ProviderError(data.error==='invalid_grant'?'Reconnect required: eBay authorization expired or revoked':'Token refresh temporarily unavailable',response.status,data.error==='invalid_grant'?21600:300);
 if(typeof data.access_token!=='string'||!data.access_token||!Number.isFinite(data.expires_in)||data.expires_in<=0)throw new ProviderError('Invalid token refresh response');
 // eBay normally returns only a new access token; preserve the stored refresh token.
 return {access_token:data.access_token,expires_in:data.expires_in,token_type:data.token_type||'User Access Token'};
}
export async function request(url,token,options={},fetcher=fetch){
 const response=await fetcher(url,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-EBAY-C-MARKETPLACE-ID':'EBAY_US',...options.headers},signal:AbortSignal.timeout(20000)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok||data.errors?.length){
  const codes=(data.errors||[]).map(e=>e.errorId||e.extensions?.errorId||e.extensions?.code).filter(Boolean).join(',').replace(/[^a-zA-Z0-9_,.-]/g,'').slice(0,60);
  throw new ProviderError('eBay HTTP '+response.status+(codes?' / '+codes:''),response.status,Number(response.headers.get('retry-after'))||0);
 }
 return data;
}
const DAY=86400000;
const date=value=>new Date(value).toISOString();
const day=value=>date(value).slice(0,10).replaceAll('-','');
const listingFields=`listings { listingId listing { marketplace sellerProduct { title images { ebayImageUrl externalImageUrl order } } listingTerms { totalQuantityAvailable listingFormat lifecycleTerms { listingStatus startAt actualEndAt } } items { itemId sku itemTerms { availability { quantityAvailable quantitySold } pricingTerms { fixedPrice { original { currency value } } } } } } } pagination { nextCursor totalElements totalPages }`;
export async function readPage(job,token,fetcher=fetch,now=Date.now()){
 const c=job.cursor||{},end=c.end||date(now),offset=c.offset||0;
 const get=(url,options)=>request(url,token,options,fetcher);
 let rows,next=null,reconcileActive;
 if(job.resource==='listings'){
  const phase=c.phase||'active',field=phase+'Listings',input='Seller'+phase[0].toUpperCase()+phase.slice(1)+'ListingSearchInput';
  const filters=job.watermark?{modifiedAtRange:{startAt:date(Date.parse(job.watermark)-5*60000),endAt:end}}:undefined;
  const result=await get('https://graphqlapi.ebay.com/graphql',{method:'POST',body:JSON.stringify({query:`query MirrorListings($input: ${input}) { sellerListingSearch { ${field}(searchInput: $input) { __typename ... on SellerListings { ${listingFields} } } } }`,variables:{input:{filters,pagination:{maxPageSize:100,...(c.pageCursor?{pageCursor:c.pageCursor}:{})}}}})});
  const page=result.data?.sellerListingSearch?.[field];
  if(page?.__typename!=='SellerListings'||!Array.isArray(page.listings))throw new ProviderError('eBay listing response could not be validated');
  rows=page.listings.map(data=>({id:data.listingId,data:{...data,syncCategory:phase,catalog_present:true}}));
  if(page.pagination?.nextCursor)next={end,phase,pageCursor:page.pagination.nextCursor};
  else if(phase==='active')next={end,phase:'ended'};
  else if(phase==='ended')next={end,phase:'scheduled'};
  if(phase==='active'&&!page.pagination?.nextCursor&&!job.watermark)reconcileActive=end;
 } else if(job.resource==='traffic'||job.resource==='listing_traffic'){
  const perListing=job.resource==='listing_traffic';
  const finish=c.reportEnd?Date.parse(c.reportEnd):Date.parse(end)-DAY;
  const floor=Date.parse(end)-365*DAY;
  const start=perListing||job.watermark?finish-29*DAY:Math.max(floor,finish-89*DAY);
  if(perListing&&!job.listing_ids?.length)return {records:[],cursor:{},done:true,watermark:end};
  const params=new URLSearchParams({dimension:perListing?'LISTING':'DAY',filter:`${perListing?'listing_ids:{'+job.listing_ids.join('|')+'}':'marketplace_ids:{EBAY_US}'},date_range:[${day(start)}..${day(finish)}]`,metric:'TOTAL_IMPRESSION_TOTAL,LISTING_VIEWS_TOTAL,TRANSACTION'});
  const data=await get('https://api.ebay.com/sell/analytics/v1/traffic_report?'+params);
  if(!Array.isArray(data.records))throw new ProviderError('eBay traffic response could not be validated');
  rows=data.records.map(record=>({id:(perListing?'':'EBAY_US:')+record.dimensionValues?.[0]?.value,data:{...record,header:data.header,lastUpdatedDate:data.lastUpdatedDate,requestedFrom:day(start),requestedTo:day(finish)}}));
  if(perListing&&job.listing_ids.length===50)next={end,after:job.listing_ids.at(-1)};
  if(!perListing&&!job.watermark&&start>floor)next={end,reportEnd:date(start-DAY)};
 } else {
  const start=c.start||(job.resource==='orders'&&job.watermark?date(Date.parse(job.watermark)-5*60000):date(now-89*DAY));
  let url,key,id;
  const params=new URLSearchParams({limit:'100',offset:String(offset)});
  if(job.resource==='orders'){
   params.set('filter',`${job.watermark?'lastmodifieddate':'creationdate'}:[${start}..${end}]`);
   url='https://api.ebay.com/sell/fulfillment/v1/order';key='orders';id='orderId';
  }else if(job.resource==='transactions'){
   params.set('filter',`transactionDate:[${start}..${end}]`);
   url='https://apiz.ebay.com/sell/finances/v1/transaction';key='transactions';id='transactionId';
  }else if(job.resource==='returns'){
   params.set('creation_date_range_from',start);params.set('creation_date_range_to',end);params.set('role','SELLER');
   url='https://api.ebay.com/post-order/v2/return/search';key='members';id='returnId';
  }else throw new ProviderError('Unsupported resource');
  const data=await get(url+'?'+params,job.resource==='returns'?{headers:{Authorization:'IAF '+token}}:undefined);
  if(!Array.isArray(data[key])&&data.total!==0)throw new ProviderError('eBay '+job.resource+' response could not be validated');
  const entries=data[key]||[];
  rows=entries.map(data=>({id:String(data[id]||''),data}));
  // Fetch one extra empty page when the API does not expose a total.
  if(entries.length===100)next={start,end,offset:offset+100};
 }
 if(rows.some(r=>!r.id||r.id.endsWith(':undefined')))throw new ProviderError('Missing eBay record identifier');
 return {records:rows,cursor:next||{},done:!next,watermark:end,...(reconcileActive?{reconcile_active_before:reconcileActive}:{})};
}
