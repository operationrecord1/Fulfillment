import {test} from 'node:test';
import assert from 'node:assert/strict';
import {refreshAccess,readPage} from './supabase/functions/ebay-sync/provider.mjs';
test('refresh preserves long-lived token by returning access fields only',async()=>{
 const token=await refreshAccess({ebay_client_id:'id',ebay_client_secret:'secret'},'refresh',async(url,init)=>{
  assert.equal(new URLSearchParams(init.body).get('grant_type'),'refresh_token');
  return Response.json({access_token:'new',expires_in:7200});
 });
 assert.equal(token.access_token,'new');assert.equal('refresh_token' in token,false);
});
test('order cursor keeps fixed window and offset; incremental overlap prevents boundary loss',async()=>{
 const first=await readPage({resource:'orders',cursor:{},watermark:'2026-11-20T10:00:00Z'},'token',async(url)=>{
  assert.match(new URL(url).searchParams.get('filter'),/lastmodifieddate:\[2026-11-20T09:55:00/);
  return Response.json({orders:Array.from({length:100},(_,i)=>({orderId:String(i)}))});
 },Date.parse('2026-11-20T10:03:00Z'));
 assert.equal(first.done,false);assert.equal(first.cursor.offset,100);
 const last=await readPage({resource:'orders',cursor:first.cursor,watermark:'2026-11-20T10:00:00Z'},'token',async(url)=>{
  assert.match(new URL(url).searchParams.get('filter'),/10:03:00.000Z\]/);return Response.json({orders:[]});
 },Date.parse('2026-11-20T10:10:00Z'));
 assert.equal(last.done,true);assert.equal(last.watermark,'2026-11-20T10:03:00.000Z');
});
test('provider failures do not become successful empty snapshots',async()=>{
 await assert.rejects(readPage({resource:'orders'},'token',async()=>Response.json({errors:[{errorId:1001,message:'private detail'}]},{status:403})),e=>e.message==='eBay HTTP 403 / 1001');
 await assert.rejects(readPage({resource:'orders'},'token',async()=>Response.json({unexpected:true})),/validated/);
});
test('listing cursor walks active, ended and scheduled only after successful pages',async()=>{
 const result=await readPage({resource:'listings'},'token',async(url,init)=>{
  assert.equal(url,'https://graphqlapi.ebay.com/graphql');assert.ok(JSON.parse(init.body).variables.input.pagination);
  return Response.json({data:{sellerListingSearch:{activeListings:{__typename:'SellerListings',listings:[{listingId:'123'}],pagination:{}}}}});
 });
 assert.equal(result.cursor.phase,'ended');assert.equal(result.records[0].id,'123');assert.equal(result.done,false);
});
test('traffic history uses bounded windows and listing analytics batches IDs',async()=>{
 const fetcher=async(url)=>{
  const p=new URL(url).searchParams;assert.ok(p.get('filter').includes('date_range:'));
  return Response.json({records:[{dimensionValues:[{value:'123'}],metricValues:[]}],header:{}});
 };
 const historical=await readPage({resource:'traffic'},'token',fetcher,Date.parse('2026-11-22T00:00:00Z'));
 assert.equal(historical.done,false);assert.ok(historical.cursor.reportEnd);
 const listing=await readPage({resource:'listing_traffic',listing_ids:['123']},'token',fetcher);
 assert.equal(listing.done,true);assert.equal(listing.records[0].id,'123');
});

test('active catalog reconciliation waits for the last full-scan page',async()=>{
 const fetcher=next=>async()=>Response.json({data:{sellerListingSearch:{activeListings:{__typename:'SellerListings',listings:[{listingId:'123'}],pagination:next?{nextCursor:'next'}:{}}}}});
 const partial=await readPage({resource:'listings'},'token',fetcher(true));
 assert.equal(partial.reconcile_active_before,undefined);
 const complete=await readPage({resource:'listings',cursor:partial.cursor},'token',fetcher(false));
 assert.equal(complete.reconcile_active_before,partial.cursor.end);
 assert.equal(complete.records[0].data.catalog_present,true);
 const incremental=await readPage({resource:'listings',watermark:'2026-11-22T00:00:00Z'},'token',fetcher(false));
 assert.equal(incremental.reconcile_active_before,undefined);
});
