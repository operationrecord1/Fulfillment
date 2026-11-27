CREATE OR REPLACE FUNCTION public.ebay_sync_worker(action text, payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j fulfillment_private.ebay_sync_jobs; c fulfillment_private.ebay_connections; t jsonb; r jsonb; target uuid; token uuid;
begin
 if action='claim' then
  -- Serialize claim selection, including claims for different resources of one seller.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ebay_sync_claim',0));
  update fulfillment_private.ebay_sync_jobs set cursor='{}',watermark=null,reset_requested=false,available_at=now() where reset_requested and coalesce(lease_until,now())<=now();
  insert into fulfillment_private.ebay_sync_jobs(store_id,resource)
  select store_id,k from fulfillment_private.ebay_connections cross join unnest(array['orders','listings','returns','transactions','traffic','listing_traffic','orders_history','transactions_history','delivery_tracking']) k on conflict do nothing;
  select * into j from fulfillment_private.ebay_sync_jobs a where a.available_at<=now()
   and coalesce(a.lease_until,now())<=now()
   and (a.resource<>'listing_traffic' or exists(select 1 from fulfillment_private.ebay_sync_jobs l where l.store_id=a.store_id and l.resource='listings' and l.last_success is not null))
   and not exists(select 1 from fulfillment_private.ebay_sync_jobs b where b.store_id=a.store_id and b.lease_until>now())
   order by case when a.available_at<now()-interval '15 minutes' then -1 when a.resource='orders' then 0 when a.resource='listings' then 1 when a.resource in ('orders_history','transactions_history') then 3 else 2 end,a.available_at,a.store_id,a.resource for update skip locked limit 1;
  if not found then return null; end if;
  token=gen_random_uuid();
  update fulfillment_private.ebay_sync_jobs set lease_id=token,lease_until=now()+interval '90 seconds' where store_id=j.store_id and resource=j.resource;
  select * into c from fulfillment_private.ebay_connections where store_id=j.store_id;
  select decrypted_secret::jsonb into t from vault.decrypted_secrets where id=c.token_secret_id;
  return to_jsonb(j)||jsonb_build_object('lease_id',token,'tokens',t,'access_expires_at',c.access_expires_at,'refresh_expires_at',c.refresh_expires_at,
   'image_ids',case when j.resource='orders' then coalesce((select jsonb_agg(item_id) from (select distinct r.data#>>'{lineItems,0,legacyItemId}' item_id from fulfillment_private.ebay_records r where r.store_id=j.store_id and r.resource='orders' and nullif(r.data#>>'{_orderSnapshot,image}','') is null and not exists(select 1 from fulfillment_private.ebay_image_recovery a where a.store_id=r.store_id and a.item_id=r.data#>>'{lineItems,0,legacyItemId}' and a.attempted_at>now()-interval '24 hours') limit 3) ids),'[]'::jsonb) else null end,
   'delivery_ids',case when j.resource='delivery_tracking' then fulfillment_private.due_delivery_ids(j.store_id) else null end,
   'listing_ids',case when j.resource='listing_traffic' then coalesce((select jsonb_agg(external_id order by external_id) from (select external_id from fulfillment_private.ebay_records where store_id=j.store_id and resource='listings' and external_id>coalesce(j.cursor->>'after','') order by external_id limit 50) x),'[]'::jsonb) else null end);
 end if;
 target=(payload->>'store_id')::uuid;
 select * into j from fulfillment_private.ebay_sync_jobs where store_id=target and resource=payload->>'resource' and lease_id=(payload->>'lease_id')::uuid and lease_until>now() for update;
 if not found then raise exception 'Sync lease expired'; end if;
 if action='token' then
  select * into c from fulfillment_private.ebay_connections where store_id=target for update;
  select decrypted_secret::jsonb into t from vault.decrypted_secrets where id=c.token_secret_id;
  if length(payload->'tokens'->>'access_token')<10 or (payload->'tokens'->>'expires_in')::integer<=0 then raise exception 'Invalid token response'; end if;
  perform vault.update_secret(c.token_secret_id,(t||(payload->'tokens'))::text);
  update fulfillment_private.ebay_connections set access_expires_at=now()+make_interval(secs=>(payload->'tokens'->>'expires_in')::integer),updated_at=now() where store_id=target;
 elsif action='commit' then
  for r in select value from jsonb_array_elements(payload->'records') loop
   if coalesce(r->>'id','')='' then raise exception 'Missing eBay record ID'; end if;
   if j.resource='listings' and payload ? 'snapshot' then
    insert into fulfillment_private.ebay_listing_stage values(target,payload#>>'{snapshot,id}',r->>'id',r->'data') on conflict(store_id,scan_id,external_id) do update set data=excluded.data;
   else
   insert into fulfillment_private.ebay_records(store_id,resource,external_id,data) values(target,case when j.resource='orders_history' then 'orders' when j.resource='transactions_history' then 'transactions' else j.resource end,r->>'id',r->'data')
    on conflict(store_id,resource,external_id) do update set data=excluded.data,updated_at=now()
    where j.resource<>'orders_history' or not(fulfillment_private.ebay_records.data ? 'lastModifiedDate') or coalesce(excluded.data->>'lastModifiedDate','')>=fulfillment_private.ebay_records.data->>'lastModifiedDate';
  end if;
  end loop;
  if j.resource='listings' and payload ? 'snapshot' and (payload->>'done')::boolean then
   if exists(select 1 from jsonb_each_text(payload#>'{snapshot,totals}') t where t.value::bigint<>(select count(*) from fulfillment_private.ebay_listing_stage st where st.store_id=target and st.scan_id=payload#>>'{snapshot,id}' and st.data->>'syncCategory'=t.key)) then raise exception 'Listing snapshot count mismatch';end if;
   insert into fulfillment_private.ebay_records(store_id,resource,external_id,data) select store_id,'listings',external_id,data from fulfillment_private.ebay_listing_stage where store_id=target and scan_id=payload#>>'{snapshot,id}' on conflict(store_id,resource,external_id) do update set data=excluded.data,updated_at=now();
   delete from fulfillment_private.ebay_listing_stage where store_id=target;
   update fulfillment_private.ebay_notification_inbox set processed_at=now(),disposition='processed' where store_id=target and resource='listings' and disposition='pending' and processed_at is null and received_at<=(payload->>'watermark')::timestamptz;
  end if;
  if j.resource='listings' and payload ? 'reconcile_active_before' then
   update fulfillment_private.ebay_records set data=data||'{"catalog_present":false}'::jsonb,updated_at=now() where store_id=target and resource='listings' and data#>>'{listing,listingTerms,lifecycleTerms,listingStatus}'='ACTIVE' and updated_at<(payload->>'reconcile_active_before')::timestamptz;
  end if;
  -- Never acknowledge an event until a fresh provider record has actually been saved.
  update fulfillment_private.ebay_notification_inbox e set processed_at=now(),disposition='processed'
  where e.store_id=target and e.resource=j.resource and e.processed_at is null and e.disposition='pending'
  and e.received_at<=(ebay_sync_worker.payload->>'watermark')::timestamptz
  and exists(select 1 from fulfillment_private.ebay_records mirror where mirror.store_id=target and mirror.resource=j.resource and mirror.external_id=e.entity_id and mirror.updated_at>=e.received_at);
  update fulfillment_private.ebay_sync_jobs set cursor=coalesce(payload->'cursor','{}'),
   watermark=case when (payload->>'done')::boolean then (payload->>'watermark')::timestamptz else watermark end,
   last_success=case when (payload->>'done')::boolean then now() else last_success end,
   coverage_from=coalesce((payload->>'history_from')::timestamptz,coverage_from),
   last_full_scan=case when (payload->>'done')::boolean and ((j.resource='listings' and payload ? 'snapshot') or (j.resource='transactions' and payload->>'finance_reconcile'='true')) then now() else last_full_scan end,
   available_at=now()+make_interval(secs=>case when not (payload->>'done')::boolean then 0 when resource in ('orders_history','transactions_history') then 315360000 when resource='transactions' then 120 when resource='delivery_tracking' then 60 when resource='orders' and exists(select 1 from fulfillment_private.ebay_notification_subscriptions s where s.store_id=target and s.status='ENABLED' and s.topic=case when j.resource='orders' then 'ORDER_CONFIRMATION' else 'LISTING' end) then 300 when resource='listings' then 1800 when resource='orders' then 120 when resource in ('traffic','listing_traffic') then 43200 else 600 end),
   lease_id=null,lease_until=null,last_error=null,failures=0 where store_id=target and resource=j.resource;
 elsif action='fail' then
  if j.resource='listings' then update fulfillment_private.ebay_sync_jobs set cursor='{}' where store_id=target and resource=j.resource;delete from fulfillment_private.ebay_listing_stage where store_id=target;end if;
  if j.resource in ('traffic','listing_traffic') and payload->>'error' like 'eBay HTTP 429%' then
   update fulfillment_private.ebay_sync_jobs set available_at=now()+interval '24 hours',last_error='eBay analytics quota reached; saved report retained',failures=failures+1,lease_id=null,lease_until=null where store_id=target and resource in ('traffic','listing_traffic');
   return '{}'::jsonb;
  end if;
  update fulfillment_private.ebay_sync_jobs set last_error=left(payload->>'error',160),failures=failures+1,
   available_at=now()+make_interval(secs=>least(21600,greatest(60,coalesce((payload->>'retry_after')::integer,0),60*power(2,least(failures,8))::integer))),
   lease_id=null,lease_until=null where store_id=target and resource=j.resource;
 else raise exception 'Unknown sync operation'; end if;
 return '{}'::jsonb;
end $function$
;
